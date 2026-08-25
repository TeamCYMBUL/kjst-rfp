import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// Read from the project secret (set in Supabase > Edge Functions > Secrets),
// same as every other function. Never hardcode the key in source.
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
    const { email, name, temp_password } = await req.json()
    if (!email || !name) {
      return new Response(JSON.stringify({ error: 'email and name are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const password = temp_password ?? 'KJST2026!'
    const firstName = name.split(' ')[0]

    const subject = 'Welcome to the KJST RFP Platform'

    const htmlBody = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333; line-height: 1.6;">
  <div style="background-color: #1C1008; padding: 24px 32px; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 20px;">KJ Sports Travel</h1>
    <p style="color: #d4a96a; margin: 4px 0 0; font-size: 14px;">RFP Platform</p>
  </div>
  <div style="background: #fff; padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
    <h2 style="color: #1C1008; margin-top: 0;">Welcome, ${firstName}!</h2>
    <p>You've been set up with access to the <strong>KJST RFP Platform</strong> — the system we use to manage hotel RFPs for our client teams.</p>
    <p>The platform lets you:</p>
    <ul style="color: #555;">
      <li>Create and manage trips for KJST clients</li>
      <li>Invite hotels to submit bids via secure links</li>
      <li>Review and compare hotel proposals side by side</li>
      <li>Export comparison grids and client-ready summaries</li>
    </ul>
    <div style="background: #f8f7f5; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 24px 0;">
      <p style="margin: 0 0 12px; font-weight: bold; color: #1C1008;">Your login credentials</p>
      <p style="margin: 4px 0;"><strong>Login URL:</strong> <a href="https://kjst-rfp.vercel.app" style="color: #1C1008;">https://kjst-rfp.vercel.app</a></p>
      <p style="margin: 4px 0;"><strong>Email:</strong> ${email}</p>
      <p style="margin: 4px 0;"><strong>Temporary password:</strong> <code style="background: #e5e7eb; padding: 2px 6px; border-radius: 4px; font-size: 14px;">${password}</code></p>
    </div>
    <p style="color: #e53e3e; font-size: 14px;"><strong>Please change your password</strong> after your first login via your account settings.</p>
    <p>If you have any questions, reply to this email or reach out directly.</p>
    <p style="margin-top: 32px;">
      Welcome aboard,<br/>
      <strong>Anabel Cabrera</strong><br/>
      KJ Sports Travel<br/>
      <a href="mailto:acabrera@kjsportstravel.com" style="color: #1C1008;">acabrera@kjsportstravel.com</a>
    </p>
  </div>
</div>
`.trim()

    const textBody = `Welcome, ${firstName}!

You've been set up with access to the KJST RFP Platform — the system we use to manage hotel RFPs for our client teams.

Login URL: https://kjst-rfp.vercel.app
Email: ${email}
Temporary password: ${password}

Please change your password after your first login.

If you have any questions, reply to this email or reach out directly.

Welcome aboard,
Anabel Cabrera
KJ Sports Travel
acabrera@kjsportstravel.com`

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'KJ Sports Travel <onboarding@resend.dev>',
        to: [email],
        subject,
        html: htmlBody,
        text: textBody,
      }),
    })

    const resendData = await resendResponse.json()

    if (!resendResponse.ok) {
      return new Response(JSON.stringify({ error: 'Failed to send email', detail: resendData }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true, message_id: resendData.id }), {
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
