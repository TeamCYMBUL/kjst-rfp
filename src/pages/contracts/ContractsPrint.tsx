// Printable Contracts summary — a clean, at-a-glance report of every awarded
// hotel and where its room agreement stands, grouped by client. Rendered
// outside the dashboard chrome so Print / Save-as-PDF flows cleanly.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { listAwardedContracts } from '../../lib/contractsApi'
import type { AwardedContract, ContractStatus } from '../../lib/contractsApi'
import { buildContractsDoc, downloadDocx } from '../../lib/reportDocx'

const PRIMARY = '#1C1008'
const STATUS_LABEL: Record<ContractStatus, string> = {
  requested: 'Requested', uploaded: 'Uploaded', in_review: 'In review',
  verified: 'Verified', signed: 'Signed', filed: 'Filed',
}
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')

export default function ContractsPrint() {
  const [rows, setRows] = useState<AwardedContract[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listAwardedContracts().then(setRows).catch((e) => setError(e.message ?? 'Failed to load'))
  }, [])

  const groups = useMemo(() => {
    if (!rows) return []
    const byClient = new Map<string, { name: string; items: AwardedContract[] }>()
    for (const r of rows) {
      const key = r.client?.id ?? 'unknown'
      if (!byClient.has(key)) byClient.set(key, { name: r.client?.team_name ?? 'Unknown client', items: [] })
      byClient.get(key)!.items.push(r)
    }
    return [...byClient.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [rows])

  if (error) return <div style={{ padding: 24, fontFamily: 'system-ui', color: '#dc2626' }}>{error}</div>
  if (!rows) return <div style={{ padding: 24, fontFamily: 'system-ui', color: '#64748b' }}>Loading…</div>

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 28px', fontFamily: 'system-ui', color: '#1e293b' }}>
      <style>{`@media print { .no-print { display: none !important; } } @page { margin: 16mm; }`}</style>

      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
        <Link to="/contracts" style={{ fontSize: 13, color: '#64748b', textDecoration: 'none' }}>← Back to Contracts</Link>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => downloadDocx(
              buildContractsDoc({
                dateStr: `Room agreements for awarded hotels · KJ Sports Travel · ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
                groups: groups.map((g) => ({
                  name: g.name,
                  rows: g.items.map((r) => {
                    const c = r.contract
                    return { hotelName: r.hotel_name, city: r.trip?.city ?? null, statusLabel: c ? STATUS_LABEL[c.status] : 'Not requested', uploaded: c?.uploaded_at ? fmt(c.uploaded_at) : null, signed: c?.signed_at ? fmt(c.signed_at) : null }
                  }),
                })),
              }),
              'KJST Contracts Summary.docx',
            )}
            style={{ background: PRIMARY, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            Download Word (.docx)
          </button>
        </div>
      </div>

      <div style={{ borderBottom: `2px solid ${PRIMARY}`, paddingBottom: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: PRIMARY }}>Contracts summary</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
          Room agreements for awarded hotels · KJ Sports Travel · {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </div>

      {groups.length === 0 && <p style={{ fontSize: 14, color: '#64748b' }}>No awarded hotels yet.</p>}

      {groups.map((g) => (
        <div key={g.name} style={{ marginBottom: 24, breakInside: 'avoid' }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: PRIMARY, margin: '0 0 8px' }}>{g.name}</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#94a3b8', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '6px 8px', fontWeight: 600 }}>Hotel</th>
                <th style={{ padding: '6px 8px', fontWeight: 600 }}>City</th>
                <th style={{ padding: '6px 8px', fontWeight: 600 }}>Status</th>
                <th style={{ padding: '6px 8px', fontWeight: 600 }}>Uploaded</th>
                <th style={{ padding: '6px 8px', fontWeight: 600 }}>Signed</th>
              </tr>
            </thead>
            <tbody>
              {g.items.map((r) => {
                const c = r.contract
                const status = c ? STATUS_LABEL[c.status] : 'Not requested'
                return (
                  <tr key={r.invitation_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '6px 8px', fontWeight: 500 }}>{r.hotel_name}</td>
                    <td style={{ padding: '6px 8px', color: '#475569' }}>{r.trip?.city ?? '—'}</td>
                    <td style={{ padding: '6px 8px', color: '#475569' }}>{status}</td>
                    <td style={{ padding: '6px 8px', color: '#475569' }}>{fmt(c?.uploaded_at ?? null)}</td>
                    <td style={{ padding: '6px 8px', color: '#475569' }}>{fmt(c?.signed_at ?? null)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
