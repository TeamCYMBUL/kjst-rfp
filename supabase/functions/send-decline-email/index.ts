import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  try {
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY secret not set.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { invitation_id } = await req.json()
    if (!invitation_id) {
      return new Response(JSON.stringify({ error: 'invitation_id is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Look up invitation with trip and client info
    const { data, error: queryError } = await supabase.rpc('get_decline_email_data', { p_invitation_id: invitation_id })

    // Fall back to direct query if RPC doesn't exist
    let invitation: any = null
    if (queryError || !data) {
      const { data: invData, error: invError } = await supabase
        .from('rfp_invitations')
        .select(`
          id, hotel_name, hotel_contact_name, hotel_contact_email, trip_id,
          trips!inner(
            city, opponent_label, arrival_date, departure_date,
            clients!inner(team_name)
          )
        `)
        .eq('id', invitation_id)
        .single()

      if (invError || !invData) {
        return new Response(JSON.stringify({ error: 'Invitation not found', detail: invError?.message }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      invitation = invData
    } else {
      invitation = data
    }

    const trip = (invitation as any).trips
    const client = trip?.clients

    const city = trip?.city ?? 'the city'
    const opponentLabel = trip?.opponent_label ?? 'the upcoming trip'
    const arrivalDate = trip?.arrival_date
      ? new Date(trip.arrival_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : null
    const departureDate = trip?.departure_date
      ? new Date(trip.departure_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : null

    const contactEmail = invitation.hotel_contact_email
    if (!contactEmail) {
      return new Response(JSON.stringify({ error: 'No contact email on file for this hotel' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const contactName = invitation.hotel_contact_name ?? 'Team'
    const hotelName = invitation.hotel_name

    const dateRange = arrivalDate && departureDate
      ? ` (${arrivalDate} – ${departureDate})`
      : ''

    const subject = `Hotel RFP — ${city} — ${opponentLabel}`

    const htmlBody = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
  <p>Dear ${contactName},</p>

  <p>Thank you for taking the time to submit your proposal for our upcoming trip to <strong>${city}${dateRange}</strong> — <em>${opponentLabel}</em>.</p>

  <p>After careful review of all submitted proposals, we have selected another property for this trip. This was a competitive process and we genuinely appreciate you taking the time to put together a thorough bid.</p>

  <p>We hope to work with ${hotelName} on future opportunities and will absolutely keep you in mind as we plan upcoming trips. Please don't hesitate to stay in touch.</p>

  <p>Thank you again for your time and partnership.</p>

  <p style="margin-top: 32px;">
    Warm regards,<br/>
    <strong>KJ Sports Travel Team</strong><br/>
    <a href="mailto:team@kjsportstravel.com" style="color: #1C1008;">team@kjsportstravel.com</a>
  </p>
</div>
`.trim()

    const textBody = `Dear ${contactName},

Thank you for taking the time to submit your proposal for our upcoming trip to ${city}${dateRange} — ${opponentLabel}.

After careful review of all submitted proposals, we have selected another property for this trip. This was a competitive process and we genuinely appreciate you taking the time to put together a thorough bid.

We hope to work with ${hotelName} on future opportunities and will absolutely keep you in mind as we plan upcoming trips. Please don't hesitate to stay in touch.

Thank you again for your time and partnership.

Warm regards,
KJ Sports Travel Team
team@kjsportstravel.com`

    // Send via Resend
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'KJ Sports Travel <team@kjsportstravel.com>',
        to: [contactEmail],
        subject,
        html: htmlBody,
        text: textBody,
      }),
    })

    if (!resendResponse.ok) {
      const resendError = await resendResponse.text()
      console.error('Resend error:', resendError)
      // Still update status even if email fails — log it but don't block
    }

    // Update invitation status to 'declined'
    const { error: updateError } = await supabase
      .from('rfp_invitations')
      .update({ status: 'declined' })
      .eq('id', invitation_id)

    if (updateError) {
      console.error('Status update error:', updateError)
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (err) {
    console.error('Unexpected error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
