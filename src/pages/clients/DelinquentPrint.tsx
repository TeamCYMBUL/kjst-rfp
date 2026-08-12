import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  fetchDelinquentForClient,
  exportDelinquentXlsx,
  fmtDate,
  overdueLabel,
  type DelinquentReport,
} from '../../lib/delinquent'
import { buildDelinquentDoc, downloadDocx } from '../../lib/reportDocx'

const PRIMARY = '#1C1008'

// Client-level "delinquent hotels" report — hotels that missed the RFP deadline
// without bidding. Printable (Print / Save as PDF) and exportable (.xlsx), so a
// KJST manager can share it with a hotel brand's Global Sales Office rep.
export default function DelinquentPrint() {
  const { id: clientId } = useParams<{ id: string }>()
  const [report, setReport] = useState<DelinquentReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!clientId) return
    fetchDelinquentForClient(clientId)
      .then((r) => setReport(r))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [clientId])

  if (loading) {
    return <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif', color: '#64748b' }}>Loading report…</div>
  }
  if (error || !report) {
    return <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif', color: '#ef4444' }}>{error || 'Report unavailable.'}</div>
  }

  const { client, rows } = report
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b', borderBottom: '2px solid #e2e8f0' }
  const td: React.CSSProperties = { padding: '8px 10px', fontSize: 13, color: '#1e293b', borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }

  return (
    <>
      <style>{`@media print { .no-print { display: none !important; } @page { margin: 0.6in; size: landscape; } } * { box-sizing: border-box; }`}</style>

      <div className="no-print" style={{ position: 'fixed', top: 16, right: 16, display: 'flex', gap: 8, zIndex: 100 }}>
        <button
          onClick={() => downloadDocx(
            buildDelinquentDoc({
              teamName: client.team_name,
              season: client.season ?? null,
              dateStr,
              rows: rows.map((r) => ({ hotelName: r.hotelName, city: r.city, arrivalDate: r.arrivalDate, departureDate: r.departureDate, responseDeadline: r.responseDeadline, statusLabel: overdueLabel(r), contactName: r.contactName, contactEmail: r.contactEmail })),
            }),
            `${client.team_name} Delinquent Hotels.docx`,
          )}
          style={{ background: PRIMARY, color: 'white', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >Download Word (.docx)</button>
        <button onClick={() => window.print()} style={{ background: 'white', color: PRIMARY, border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>Print / Save as PDF</button>
        <button onClick={() => exportDelinquentXlsx(report)} style={{ background: 'white', color: PRIMARY, border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Export Excel</button>
        <Link to={`/clients/${clientId}`} style={{ background: 'white', color: PRIMARY, border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 500, textDecoration: 'none' }}>← Back to Client</Link>
      </div>

      <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 1000, margin: '0 auto', padding: '0 24px 48px' }}>
        {/* Branding band */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, background: PRIMARY, color: 'white', borderRadius: '12px 12px 0 0', padding: '22px 28px', marginTop: 40 }}>
          {client.logo_url && (
            <img src={client.logo_url} alt="" style={{ width: 52, height: 52, objectFit: 'contain', background: 'white', borderRadius: 8, padding: 4 }} />
          )}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#d6c3b0' }}>KJ Sports Travel</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{client.team_name}{client.season ? `  ·  ${client.season}` : ''}</div>
          </div>
        </div>
        <div style={{ border: '1px solid #e2e8f0', borderTop: 'none', padding: '16px 28px', background: '#f8fafc' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>Delinquent Hotels</div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
            Hotels invited to bid that are past the RFP response deadline without submitting — as of {dateStr}.
          </div>
        </div>

        {rows.length === 0 ? (
          <div style={{ border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '48px 28px', textAlign: 'center', color: '#94a3b8', fontSize: 15 }}>
            No delinquent hotels — everyone has responded or is still within their deadline.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #e2e8f0', borderTop: 'none' }}>
            <thead>
              <tr>
                <th style={th}>Hotel</th>
                <th style={th}>City</th>
                <th style={th}>Trip dates</th>
                <th style={th}>Deadline</th>
                <th style={th}>Status</th>
                <th style={th}>Hotel contact</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ ...td, fontWeight: 600 }}>{r.hotelName}</td>
                  <td style={td}>{r.city ?? '—'}</td>
                  <td style={td}>{fmtDate(r.arrivalDate)} – {fmtDate(r.departureDate)}</td>
                  <td style={td}>{r.responseDeadline ? fmtDate(r.responseDeadline) : 'None set'}</td>
                  <td style={{ ...td, color: '#b91c1c', fontWeight: 700 }}>{overdueLabel(r)}</td>
                  <td style={td}>
                    {r.contactName || '—'}
                    {r.contactEmail && <div style={{ fontSize: 12, color: '#64748b' }}>{r.contactEmail}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ marginTop: 16, fontSize: 12, color: '#94a3b8' }}>
          {rows.length} hotel{rows.length !== 1 ? 's' : ''} past deadline · KJ Sports Travel · team@kjsportstravel.com
        </div>
      </div>
    </>
  )
}
