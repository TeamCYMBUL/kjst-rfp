import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Client, Trip } from '../../lib/types'
import { formatDate } from '../../lib/format'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  LinkButton,
  Loading,
  PageHeader,
} from '../../components/ui'

type TripRow = Pick<
  Trip,
  'id' | 'opponent_label' | 'city' | 'arrival_date' | 'departure_date' | 'status'
>

// One labeled value in the info grid; renders an em dash when empty.
function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-700">{value || '—'}</dd>
    </div>
  )
}

export default function ClientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [client, setClient] = useState<Client | null>(null)
  const [trips, setTrips] = useState<TripRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    supabase
      .from('clients')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setClient(data as Client)
      })

    supabase
      .from('trips')
      .select('id, opponent_label, city, arrival_date, departure_date, status')
      .eq('client_id', id)
      .order('arrival_date', { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setTrips(data as TripRow[])
      })
  }, [id])

  const remove = async () => {
    if (!confirm('Delete this client? This cannot be undone.')) return
    setDeleting(true)
    const { error } = await supabase.from('clients').delete().eq('id', id)
    if (error) {
      setError(error.message)
      setDeleting(false)
    } else {
      navigate('/clients')
    }
  }

  if (error) return <ErrorNote message={error} />
  if (!client) return <Loading />

  const t = client.default_terms ?? {}

  return (
    <div>
      <PageHeader
        title={client.team_name}
        subtitle={[client.league, client.season].filter(Boolean).join(' · ') || undefined}
        action={
          <div className="flex gap-2">
            <LinkButton to={`/clients/${id}/edit`} variant="secondary">
              Edit
            </LinkButton>
            <LinkButton to={`/trips/new?client=${id}`}>New Trip</LinkButton>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Trips
            </h2>
            {!trips ? (
              <Loading />
            ) : trips.length === 0 ? (
              <EmptyState title="No trips yet.">
                <LinkButton to={`/trips/new?client=${id}`}>Create the first trip</LinkButton>
              </EmptyState>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-4 font-medium">Opponent</th>
                    <th className="py-2 pr-4 font-medium">City</th>
                    <th className="py-2 pr-4 font-medium">Dates</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {trips.map((trip) => (
                    <tr
                      key={trip.id}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                    >
                      <td className="py-2 pr-4">
                        <Link
                          to={`/trips/${trip.id}`}
                          className="font-medium text-[#1C1008] hover:underline"
                        >
                          {trip.opponent_label || 'Untitled trip'}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 text-slate-600">{trip.city || '—'}</td>
                      <td className="py-2 pr-4 text-slate-600">
                        {formatDate(trip.arrival_date)} – {formatDate(trip.departure_date)}
                      </td>
                      <td className="py-2">
                        <Badge status={trip.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Default terms
            </h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label="Commission %" value={t.commission_pct} />
              <Field label="Attrition %" value={t.attrition_pct} />
              <Field
                label="Default king rooms"
                value={t.default_king_rooms != null ? String(t.default_king_rooms) : null}
              />
              <Field
                label="Default suites"
                value={t.default_suites != null ? String(t.default_suites) : null}
              />
              <Field
                label="Default total rooms"
                value={t.default_total_rooms != null ? String(t.default_total_rooms) : null}
              />
              <Field label="In-season tournament window" value={t.in_season_tournament_window} />
              <Field label="Postseason window" value={t.postseason_window} />
              <Field label="Postseason rooms" value={t.postseason_rooms_text} />
              <div className="sm:col-span-2">
                <Field label="Guarantee language" value={t.guarantee_language} />
              </div>
            </dl>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Details
            </h2>
            <dl className="space-y-4">
              <Field label="Legal entity" value={client.legal_entity} />
              <Field label="Agreement status" value={t.agreement_status} />
              <Field label="Contact" value={client.primary_contact_name} />
              <Field label="Title" value={client.primary_contact_title} />
              <Field label="Email" value={client.primary_contact_email} />
              <Field label="Phone" value={client.primary_contact_phone} />
              <Field label="Address" value={client.primary_contact_address} />
            </dl>
          </Card>

          <Card className="p-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Danger zone
            </h2>
            <Button variant="danger" onClick={remove} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete client'}
            </Button>
          </Card>
        </div>
      </div>
    </div>
  )
}
