// Staff Contracts page — every awarded hotel and where its room agreement stands.
// The hotel uploads via the link in the contract-request email; it lands here.
// Staff can view the uploaded agreement, move it through review, and upload the
// final signed copy so the whole lifecycle lives in the platform.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ErrorNote, Loading } from '../../components/ui'
import {
  listAwardedContracts, updateContractStatus, uploadSignedCopy, uploadContractStaff,
} from '../../lib/contractsApi'
import type { AwardedContract, ContractStatus } from '../../lib/contractsApi'
import { ContractFactCheck } from './ContractFactCheck'
import { ContractViewer } from './ContractViewer'
import { useAuth } from '../../auth/AuthContext'
import { isContractsUser } from '../../lib/activity'

const STATUS_LABEL: Record<ContractStatus, string> = {
  requested: 'Requested',
  uploaded: 'Uploaded',
  in_review: 'In review',
  verified: 'Verified',
  signed: 'Signed',
  filed: 'Filed',
}
const STATUS_STYLE: Record<ContractStatus, string> = {
  requested: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  uploaded: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  in_review: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  verified: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  signed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  filed: 'bg-emerald-600 text-white',
}
const NEXT_STATUS: ContractStatus[] = ['requested', 'uploaded', 'in_review', 'verified', 'signed', 'filed']

// Teams the contract fact-check is enabled for. Rolling out on SJ Sharks first
// (finalizing before the NBA teams); add team names here to expand.
const FACT_CHECK_TEAMS = ['sj sharks']

export default function ContractsList() {
  const [rows, setRows] = useState<AwardedContract[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null) // which contract's fact-check panel is expanded
  const [viewer, setViewer] = useState<{ path: string; fileName: string | null; title: string } | null>(null)
  const { user } = useAuth()
  const allowed = isContractsUser(user?.email)

  const load = () => {
    if (!allowed) return
    setError(null)
    listAwardedContracts()
      .then(setRows)
      .catch((e) => setError(e.message ?? 'Failed to load'))
  }
  useEffect(load, [])

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

  const setStatus = async (id: string, status: ContractStatus) => {
    setBusyId(id)
    try { await updateContractStatus(id, status); load() }
    catch (e: any) { alert(e.message ?? 'Failed to update') }
    finally { setBusyId(null) }
  }

  const onUploadSigned = async (id: string, file: File | null) => {
    if (!file) return
    setBusyId(id)
    try { await uploadSignedCopy(id, file); load() }
    catch (e: any) { alert(e.message ?? 'Upload failed') }
    finally { setBusyId(null) }
  }

  // Staff uploads the hotel's agreement directly (e.g. it came back over email).
  const onUploadContract = async (r: AwardedContract, file: File | null) => {
    if (!file) return
    setBusyId(r.contract?.id ?? r.invitation_id)
    try {
      await uploadContractStaff({ invitationId: r.invitation_id, tripId: r.trip?.id ?? null, clientId: r.client?.id ?? null }, file)
      load()
    } catch (e: any) { alert(e.message ?? 'Upload failed') }
    finally { setBusyId(null) }
  }

  if (!allowed) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-6 py-12 text-center">
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Restricted</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">The Contracts page is limited to specific accounts right now.</p>
      </div>
    )
  }
  if (error) return <ErrorNote message={error} />
  if (!rows) return <Loading />

  const total = rows.length
  const uploaded = rows.filter((r) => r.contract && r.contract.status !== 'requested').length
  const awaiting = rows.filter((r) => !r.contract || r.contract.status === 'requested').length

  return (
    <div className="space-y-6">
      {viewer && (
        <ContractViewer path={viewer.path} fileName={viewer.fileName} title={viewer.title} onClose={() => setViewer(null)} />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Contracts</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            <span className="font-medium text-slate-600 dark:text-slate-300">1.</span> Send the contract request &nbsp;·&nbsp;
            <span className="font-medium text-slate-600 dark:text-slate-300">2.</span> Hotel uploads the signed agreement &nbsp;·&nbsp;
            <span className="font-medium text-slate-600 dark:text-slate-300">3.</span> Review &amp; file it here
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex gap-4 text-right">
            <div><div className="text-2xl font-bold text-slate-800 dark:text-slate-200">{total}</div><div className="text-xs text-slate-400">awarded</div></div>
            <div><div className="text-2xl font-bold text-blue-600">{uploaded}</div><div className="text-xs text-slate-400">received</div></div>
            <div><div className="text-2xl font-bold text-amber-500">{awaiting}</div><div className="text-xs text-slate-400">awaiting</div></div>
          </div>
          <Link
            to="/contracts/print"
            className="rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            Print
          </Link>
        </div>
      </div>

      {total === 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-6 py-10 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">No awarded hotels yet. Once you award a hotel on a trip, it shows up here.</p>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.name} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
          <div className="border-b border-slate-100 dark:border-slate-700 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{g.name}</h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {g.items.map((r) => {
              const c = r.contract
              const twoVisit = !!r.trip?.stay2_arrival_date
              const stayTxt = twoVisit ? (r.awarded_stay1 && r.awarded_stay2 ? ' · Stay 1 & 2' : r.awarded_stay1 ? ' · Stay 1' : ' · Stay 2') : ''
              const busy = busyId === (c?.id ?? r.invitation_id)
              // Fact-check shows once an agreement is uploaded, and only for the
              // teams it's rolled out to (SJ Sharks first).
              const canFactCheck = !!(c && c.file_path) &&
                FACT_CHECK_TEAMS.includes((r.client?.team_name ?? '').trim().toLowerCase())
              const isOpen = openId === r.invitation_id
              const hasIssues = c?.analysis?.overall === 'issues'
              // A hotel with no contract record hasn't been requested yet — say so
              // plainly rather than mislabeling it "Requested".
              const pillLabel = c ? STATUS_LABEL[c.status] : 'Not requested'
              const pillStyle = c ? STATUS_STYLE[c.status] : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
              return (
                <div key={r.invitation_id}>
                <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-800 dark:text-slate-200">{r.hotel_name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${pillStyle}`}>{pillLabel}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {[r.trip?.city, r.trip?.opponent_label ? `vs. ${r.trip.opponent_label}` : null].filter(Boolean).join(' · ')}{stayTxt}
                      {c?.uploaded_at && <> · uploaded {new Date(c.uploaded_at).toLocaleDateString()}</>}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {!c ? (
                      <>
                        {r.trip && (
                          <Link
                            to={`/trips/${r.trip.id}?contract=${r.invitation_id}`}
                            className="rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100"
                          >
                            Send contract request →
                          </Link>
                        )}
                        {/* Already handled over email? Upload it here directly. */}
                        <label className="rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer">
                          {busy ? 'Working…' : 'Upload contract'}
                          <input type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={(e) => onUploadContract(r, e.target.files?.[0] ?? null)} />
                        </label>
                      </>
                    ) : (
                      <>
                        {c.file_path ? (
                          <button onClick={() => setViewer({ path: c.file_path!, fileName: c.file_name, title: `${r.hotel_name} — Agreement` })} className="rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
                            View agreement
                          </button>
                        ) : (
                          <label className="rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer">
                            {busy ? 'Working…' : 'Upload contract'}
                            <input type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={(e) => onUploadContract(r, e.target.files?.[0] ?? null)} />
                          </label>
                        )}
                        {canFactCheck && (
                          <button
                            onClick={() => setOpenId(isOpen ? null : r.invitation_id)}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                              hasIssues
                                ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 hover:bg-red-100'
                                : 'border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                            }`}
                          >
                            {hasIssues ? '⚠ Fact-check' : 'Fact-check'} {isOpen ? '▲' : '▾'}
                          </button>
                        )}
                        {c.signed_file_path && (
                          <button onClick={() => setViewer({ path: c.signed_file_path!, fileName: c.signed_file_name, title: `${r.hotel_name} — Signed copy` })} className="rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100">
                            View signed copy
                          </button>
                        )}
                        <select
                          value={c.status}
                          disabled={busy}
                          onChange={(e) => setStatus(c.id, e.target.value as ContractStatus)}
                          className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs text-slate-700 dark:text-slate-300"
                          title="Set contract status"
                        >
                          {NEXT_STATUS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                        </select>
                        <label className="rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer">
                          {busy ? 'Working…' : 'Upload signed copy'}
                          <input
                            type="file"
                            accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                            className="hidden"
                            onChange={(e) => onUploadSigned(c.id, e.target.files?.[0] ?? null)}
                          />
                        </label>
                      </>
                    )}
                  </div>
                </div>
                {isOpen && canFactCheck && <ContractFactCheck row={r} onDone={load} />}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
