// Owner-editable AI fact-check rules. Each rule is a plain-English instruction
// that the contract analyzer evaluates against every uploaded agreement and
// reports as its own check. Editing writes straight to the DB (RLS = owner only)
// so rules can be added or changed with no code deploy.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ErrorNote, Loading } from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { isContractRulesAdmin } from '../../lib/activity'
import {
  listContractRules, addContractRule, updateContractRule, deleteContractRule,
} from '../../lib/contractsApi'
import type { ContractCheckRule } from '../../lib/contractsApi'

export default function ContractRules() {
  const { user } = useAuth()
  const canEdit = isContractRulesAdmin(user?.email)
  const [rules, setRules] = useState<ContractCheckRule[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  const load = () => {
    setError(null)
    listContractRules().then(setRules).catch((e) => setError(e.message ?? 'Failed to load'))
  }
  useEffect(load, [])

  const add = async () => {
    const text = draft.trim()
    if (!text) return
    setBusy(true)
    try { await addContractRule(text, user?.email ?? null); setDraft(''); load() }
    catch (e: any) { setError(e.message ?? 'Failed to add rule') }
    finally { setBusy(false) }
  }
  const toggle = async (r: ContractCheckRule) => {
    setBusy(true)
    try { await updateContractRule(r.id, { active: !r.active }); load() }
    catch (e: any) { setError(e.message ?? 'Failed to update') }
    finally { setBusy(false) }
  }
  const saveEdit = async () => {
    if (!editId) return
    setBusy(true)
    try { await updateContractRule(editId, { rule_text: editText.trim() }); setEditId(null); load() }
    catch (e: any) { setError(e.message ?? 'Failed to save') }
    finally { setBusy(false) }
  }
  const remove = async (r: ContractCheckRule) => {
    if (!confirm('Delete this rule? The analyzer will stop checking it.')) return
    setBusy(true)
    try { await deleteContractRule(r.id); load() }
    catch (e: any) { setError(e.message ?? 'Failed to delete') }
    finally { setBusy(false) }
  }

  if (!canEdit) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-6 py-12 text-center">
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Restricted</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Editing fact-check rules is limited to the account owner right now.</p>
      </div>
    )
  }
  if (error) return <ErrorNote message={error} />
  if (!rules) return <Loading />

  const activeCount = rules.filter((r) => r.active).length

  return (
    <div className="space-y-6">
      <div>
        <Link to="/contracts" className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">← Contracts</Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">Fact-check rules</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
          Plain-English rules the AI applies to every contract on top of the bid comparison. Each active rule
          becomes its own check in the fact-check. {activeCount} active.
        </p>
      </div>

      {/* Add a rule */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Add a rule</label>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder='e.g. "Flag any resort or destination fee that is not fully waived for the team."'
          className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100"
        />
        <div className="mt-2 flex justify-end">
          <button
            onClick={add}
            disabled={busy || !draft.trim()}
            className="rounded-lg bg-[#1C1008] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#2a1a0f] disabled:opacity-50"
          >
            Add rule
          </button>
        </div>
      </div>

      {/* Existing rules */}
      <div className="divide-y divide-slate-100 dark:divide-slate-700 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
        {rules.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-400">No rules yet. Add one above.</p>}
        {rules.map((r) => (
          <div key={r.id} className="flex items-start gap-3 px-5 py-4">
            <button
              onClick={() => toggle(r)}
              disabled={busy}
              title={r.active ? 'Active — click to pause' : 'Paused — click to activate'}
              className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                r.active
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
              }`}
            >
              {r.active ? 'Active' : 'Paused'}
            </button>
            <div className="min-w-0 flex-1">
              {editId === r.id ? (
                <div>
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100"
                  />
                  <div className="mt-2 flex gap-2">
                    <button onClick={saveEdit} disabled={busy || !editText.trim()} className="rounded-lg bg-slate-800 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50">Save</button>
                    <button onClick={() => setEditId(null)} className="rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
                  </div>
                </div>
              ) : (
                <p className={`text-sm ${r.active ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500 line-through'}`}>{r.rule_text}</p>
              )}
            </div>
            {editId !== r.id && (
              <div className="flex shrink-0 gap-2">
                <button onClick={() => { setEditId(r.id); setEditText(r.rule_text) }} className="rounded-lg border border-slate-200 dark:border-slate-600 px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Edit</button>
                <button onClick={() => remove(r)} disabled={busy} className="rounded-lg border border-red-200 dark:border-red-800 px-2.5 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20">Delete</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
