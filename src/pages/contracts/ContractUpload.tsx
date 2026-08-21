// Public, link-only page a hotel opens from the contract-request email.
// Shows their trip context and lets them upload the signed room agreement
// straight into the platform. No login; the token in the URL scopes everything.
import { useEffect, useRef, useState } from 'react'
import { publicClientName } from '../../lib/format'
import { useParams } from 'react-router-dom'
import { getContract, uploadContract } from '../../lib/contractsApi'
import type { ContractContext } from '../../lib/contractsApi'

const PRIMARY = '#1C1008'

function fmt(d: string | null): string {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export default function ContractUpload() {
  const { token } = useParams<{ token: string }>()
  const [ctx, setCtx] = useState<ContractContext | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!token) return
    getContract(token)
      .then((d) => { setCtx(d); if (d.status !== 'requested') setDone(d.status === 'uploaded') })
      .catch((e) => setLoadError(e.message ?? 'Failed to load'))
      .finally(() => setLoading(false))
  }, [token])

  const submit = async () => {
    if (!token || !file) return
    setUploading(true); setUploadError(null)
    try {
      await uploadContract(token, file)
      setDone(true)
      const fresh = await getContract(token).catch(() => null)
      if (fresh) setCtx(fresh)
    } catch (e: any) {
      setUploadError(e.message ?? 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#64748b', fontFamily: 'system-ui' }}>Loading…</div>
  }
  if (loadError || !ctx) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'system-ui' }}>
        <div style={{ maxWidth: 440, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: PRIMARY }}>Link not found</h1>
          <p style={{ marginTop: 8, color: '#64748b', fontSize: 14 }}>{loadError ?? 'This upload link is invalid or has expired.'}</p>
        </div>
      </div>
    )
  }

  const tripLine = [publicClientName(ctx.team_name), ctx.city, ctx.opponent_label ? `vs. ${ctx.opponent_label}` : null].filter(Boolean).join(' · ')

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui', padding: '32px 16px' }}>
      <div style={{ maxWidth: 620, margin: '0 auto', background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <div style={{ background: PRIMARY, padding: '24px 32px' }}>
          <p style={{ margin: 0, color: '#d6c3b0', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>KJ Sports Travel</p>
          <h1 style={{ margin: '6px 0 0', color: '#fff', fontSize: 21, fontWeight: 700 }}>Upload your signed room agreement</h1>
        </div>

        <div style={{ padding: 32 }}>
          {ctx.contact_name && <p style={{ margin: '0 0 12px', fontSize: 15, color: '#374151' }}>Hi {ctx.contact_name},</p>}
          <p style={{ margin: '0 0 16px', fontSize: 15, color: '#475569', lineHeight: 1.6 }}>
            {ctx.hotel_name ? <strong>{ctx.hotel_name}</strong> : 'Your property'} has been selected{tripLine ? <> for <strong>{tripLine}</strong></> : ''}.
            Please upload the signed room agreement below and it will go straight to the KJ Sports Travel team.
          </p>
          {(ctx.arrival_date || ctx.stay2_arrival_date) && (
            <p style={{ margin: '0 0 20px', fontSize: 13, color: '#64748b' }}>
              {ctx.arrival_date && <>Arrival {fmt(ctx.arrival_date)}{ctx.departure_date ? ` – ${fmt(ctx.departure_date)}` : ''}</>}
              {ctx.stay2_arrival_date && <> · 2nd visit {fmt(ctx.stay2_arrival_date)}</>}
            </p>
          )}

          {done ? (
            <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 10, padding: '20px 24px' }}>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#047857' }}>✓ Agreement received</p>
              <p style={{ margin: '6px 0 0', fontSize: 14, color: '#065f46' }}>
                Thank you. We've received{ctx.file_name ? <> <strong>{ctx.file_name}</strong></> : ' your file'} and the KJ Sports Travel team has been notified.
              </p>
              <button
                onClick={() => { setDone(false); setFile(null); if (inputRef.current) inputRef.current.value = '' }}
                style={{ marginTop: 14, background: 'transparent', border: 'none', color: '#047857', fontSize: 13, fontWeight: 600, textDecoration: 'underline', cursor: 'pointer', padding: 0 }}
              >
                Upload a different file
              </button>
            </div>
          ) : (
            <>
              <label
                htmlFor="contract-file"
                style={{ display: 'block', border: '2px dashed #cbd5e1', borderRadius: 10, padding: '28px 20px', textAlign: 'center', cursor: 'pointer', background: '#f8fafc' }}
              >
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: PRIMARY }}>
                  {file ? file.name : 'Choose a file to upload'}
                </p>
                <p style={{ margin: '6px 0 0', fontSize: 12, color: '#94a3b8' }}>PDF or Word document (.pdf, .doc, .docx) · up to 20 MB</p>
                <input
                  id="contract-file"
                  ref={inputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  style={{ display: 'none' }}
                  onChange={(e) => { setFile(e.target.files?.[0] ?? null); setUploadError(null) }}
                />
              </label>

              {uploadError && <p style={{ margin: '12px 0 0', fontSize: 13, color: '#dc2626' }}>{uploadError}</p>}

              <button
                onClick={submit}
                disabled={!file || uploading}
                style={{
                  marginTop: 20, width: '100%', background: file && !uploading ? '#059669' : '#94a3b8',
                  color: '#fff', border: 'none', borderRadius: 8, padding: '14px 0', fontSize: 15, fontWeight: 600,
                  cursor: file && !uploading ? 'pointer' : 'not-allowed',
                }}
              >
                {uploading ? 'Uploading…' : 'Submit signed agreement'}
              </button>
            </>
          )}
        </div>

        <div style={{ background: '#f8fafc', borderTop: '1px solid #e2e8f0', padding: '16px 32px' }}>
          <p style={{ margin: 0, fontSize: 11, color: '#94a3b8' }}>KJ Sports Travel, Inc. · IATA #05732731 · This link is unique to your property.</p>
          <p style={{ margin: '6px 0 0', fontSize: 11, color: '#94a3b8' }}>
            <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: '#94a3b8', textDecoration: 'underline' }}>Privacy Policy</a>
            {' · '}
            <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: '#94a3b8', textDecoration: 'underline' }}>Terms of Service</a>
          </p>
        </div>
      </div>
    </div>
  )
}
