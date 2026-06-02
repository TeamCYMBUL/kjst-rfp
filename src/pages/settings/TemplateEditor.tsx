import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Button, Card, ErrorNote, Loading, PageHeader } from '../../components/ui'

type Section = 'concessions' | 'facilities' | 'in_season_tournament' | 'postseason'
type AnswerType = 'yes_no' | 'percent' | 'quantity' | 'currency' | 'text'

type TemplateItem = {
  id: string
  sort_order: number
  section: Section
  label: string
  answer_type: AnswerType
  requested_value: string | null
  allow_comment: boolean
}

type EditState = {
  label: string
  answer_type: AnswerType
  requested_value: string
  allow_comment: boolean
}

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'concessions', label: 'Concessions & Facilities' },
  { key: 'facilities', label: 'Facilities' },
  { key: 'in_season_tournament', label: 'In-Season Tournament' },
  { key: 'postseason', label: 'Postseason' },
]

const ANSWER_TYPES: { value: AnswerType; label: string }[] = [
  { value: 'yes_no', label: 'Yes / No' },
  { value: 'percent', label: 'Percent %' },
  { value: 'quantity', label: 'Quantity' },
  { value: 'currency', label: 'Currency $' },
  { value: 'text', label: 'Text' },
]

const TYPE_COLORS: Record<AnswerType, string> = {
  yes_no: 'bg-emerald-100 text-emerald-700',
  percent: 'bg-blue-100 text-blue-700',
  quantity: 'bg-purple-100 text-purple-700',
  currency: 'bg-amber-100 text-amber-700',
  text: 'bg-slate-100 text-slate-600',
}

function blankEdit(): EditState {
  return { label: '', answer_type: 'yes_no', requested_value: '', allow_comment: true }
}

function ItemForm({
  value,
  onChange,
  uid,
}: {
  value: EditState
  onChange: (next: EditState) => void
  uid: string
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs font-medium text-slate-600">
          Line item label <span className="text-red-500">*</span>
        </label>
        <textarea
          value={value.label}
          onChange={(e) => onChange({ ...value, label: e.target.value })}
          rows={3}
          placeholder="Enter the full question text…"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1C1008] focus:outline-none focus:ring-1 focus:ring-[#1C1008]"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Answer type</label>
        <select
          value={value.answer_type}
          onChange={(e) => onChange({ ...value, answer_type: e.target.value as AnswerType })}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1C1008] focus:outline-none focus:ring-1 focus:ring-[#1C1008]"
        >
          {ANSWER_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">
          Requested value <span className="text-slate-400">(optional)</span>
        </label>
        <input
          type="text"
          value={value.requested_value}
          onChange={(e) => onChange({ ...value, requested_value: e.target.value })}
          placeholder="e.g. 10%, QTY: 2, $100"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1C1008] focus:outline-none focus:ring-1 focus:ring-[#1C1008]"
        />
      </div>
      <div className="flex items-center gap-2 sm:col-span-2">
        <input
          id={`allow_comment_${uid}`}
          type="checkbox"
          checked={value.allow_comment}
          onChange={(e) => onChange({ ...value, allow_comment: e.target.checked })}
          className="h-4 w-4 rounded border-slate-300 text-[#1C1008]"
        />
        <label htmlFor={`allow_comment_${uid}`} className="text-sm text-slate-600">
          Allow counteroffer / comment field
        </label>
      </div>
    </div>
  )
}

export default function TemplateEditor() {
  const [items, setItems] = useState<TemplateItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<Section>('concessions')

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editState, setEditState] = useState<EditState>(blankEdit())
  const [saving, setSaving] = useState(false)

  // Add state
  const [showAdd, setShowAdd] = useState(false)
  const [addState, setAddState] = useState<EditState>(blankEdit())
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('organization_id')
      .single()
      .then(({ data }) => {
        if (data?.organization_id) {
          setOrgId(data.organization_id)
          loadItems(data.organization_id)
        } else {
          setLoading(false)
        }
      })
  }, [])

  const loadItems = async (oid: string) => {
    setLoading(true)
    const { data, error } = await supabase
      .from('concession_items')
      .select('id, sort_order, section, label, answer_type, requested_value, allow_comment')
      .eq('organization_id', oid)
      .eq('archived', false)
      .order('sort_order')
    if (error) setError(error.message)
    else setItems((data as TemplateItem[]) ?? [])
    setLoading(false)
  }

  const sectionItems = items
    .filter((i) => i.section === activeSection)
    .sort((a, b) => a.sort_order - b.sort_order)

  // ── Move up / down ──────────────────────────────────────────────────────────
  const moveItem = async (item: TemplateItem, direction: 'up' | 'down') => {
    const list = items
      .filter((i) => i.section === item.section)
      .sort((a, b) => a.sort_order - b.sort_order)
    const idx = list.findIndex((i) => i.id === item.id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= list.length) return
    const other = list[swapIdx]

    const [r1, r2] = await Promise.all([
      supabase.from('concession_items').update({ sort_order: other.sort_order }).eq('id', item.id),
      supabase.from('concession_items').update({ sort_order: item.sort_order }).eq('id', other.id),
    ])
    if (r1.error || r2.error) {
      setError(r1.error?.message ?? r2.error?.message ?? 'Reorder failed')
    } else {
      setItems((prev) =>
        prev.map((i) => {
          if (i.id === item.id) return { ...i, sort_order: other.sort_order }
          if (i.id === other.id) return { ...i, sort_order: item.sort_order }
          return i
        }),
      )
    }
  }

  // ── Edit ────────────────────────────────────────────────────────────────────
  const startEdit = (item: TemplateItem) => {
    setEditingId(item.id)
    setEditState({
      label: item.label,
      answer_type: item.answer_type,
      requested_value: item.requested_value ?? '',
      allow_comment: item.allow_comment,
    })
    setShowAdd(false)
  }

  const saveEdit = async () => {
    if (!editingId || !editState.label.trim()) return
    setSaving(true)
    const { error } = await supabase
      .from('concession_items')
      .update({
        label: editState.label.trim(),
        answer_type: editState.answer_type,
        requested_value: editState.requested_value.trim() || null,
        allow_comment: editState.allow_comment,
      })
      .eq('id', editingId)
    setSaving(false)
    if (error) {
      setError(error.message)
    } else {
      setItems((prev) =>
        prev.map((i) =>
          i.id === editingId
            ? {
                ...i,
                label: editState.label.trim(),
                answer_type: editState.answer_type,
                requested_value: editState.requested_value.trim() || null,
                allow_comment: editState.allow_comment,
              }
            : i,
        ),
      )
      setEditingId(null)
    }
  }

  // ── Archive (soft-delete) ───────────────────────────────────────────────────
  const archiveItem = async (item: TemplateItem) => {
    const preview = item.label.length > 70 ? item.label.slice(0, 70) + '…' : item.label
    if (
      !confirm(
        `Remove this item?\n\n"${preview}"\n\nIt will be hidden from future RFPs. Existing responses are preserved.`,
      )
    )
      return
    const { error } = await supabase
      .from('concession_items')
      .update({ archived: true })
      .eq('id', item.id)
    if (error) {
      setError(error.message)
    } else {
      setItems((prev) => prev.filter((i) => i.id !== item.id))
      if (editingId === item.id) setEditingId(null)
    }
  }

  // ── Add ─────────────────────────────────────────────────────────────────────
  const addItem = async () => {
    if (!orgId || !addState.label.trim()) return
    setAdding(true)
    const maxOrder = Math.max(
      0,
      ...items.filter((i) => i.section === activeSection).map((i) => i.sort_order),
    )
    const { data, error } = await supabase
      .from('concession_items')
      .insert({
        organization_id: orgId,
        section: activeSection,
        sort_order: maxOrder + 1,
        label: addState.label.trim(),
        answer_type: addState.answer_type,
        requested_value: addState.requested_value.trim() || null,
        allow_comment: addState.allow_comment,
        archived: false,
      })
      .select('id, sort_order, section, label, answer_type, requested_value, allow_comment')
      .single()
    setAdding(false)
    if (error) {
      setError(error.message)
    } else if (data) {
      setItems((prev) => [...prev, data as TemplateItem])
      setAddState(blankEdit())
      setShowAdd(false)
    }
  }

  if (loading) return <Loading />

  return (
    <div>
      <PageHeader
        title="RFP Template"
        subtitle="Add, edit, or reorder the concession line items sent to hotels. Changes apply to future trips only — in-flight RFPs keep the items they were sent with."
      />

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}

      {/* Section tabs */}
      <div className="mb-0 flex gap-1 border-b border-slate-200">
        {SECTIONS.map((s) => {
          const count = items.filter((i) => i.section === s.key).length
          const isActive = activeSection === s.key
          return (
            <button
              key={s.key}
              onClick={() => {
                setActiveSection(s.key)
                setEditingId(null)
                setShowAdd(false)
              }}
              className={`-mb-px rounded-t-lg border px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-slate-200 border-b-white bg-white text-[#1C1008]'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {s.label}
              <span
                className={`ml-2 rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                  isActive ? 'bg-[#1C1008]/10 text-[#1C1008]' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>

      <Card className="overflow-hidden rounded-tl-none">
        {/* Item rows */}
        <div className="divide-y divide-slate-100">
          {sectionItems.length === 0 && (
            <p className="px-6 py-8 text-center text-sm text-slate-400">
              No items in this section yet.
            </p>
          )}

          {sectionItems.map((item, idx) => (
            <div key={item.id}>
              {/* Row */}
              <div
                className={`flex items-start gap-3 px-4 py-3 ${
                  editingId === item.id ? 'bg-[#F5EFE8]' : 'hover:bg-slate-50'
                }`}
              >
                {/* Move buttons + sort order */}
                <div className="flex w-6 flex-col items-center gap-0.5 pt-0.5 text-slate-300">
                  <button
                    onClick={() => moveItem(item, 'up')}
                    disabled={idx === 0}
                    className="leading-none hover:text-slate-600 disabled:opacity-20"
                    title="Move up"
                  >
                    ▲
                  </button>
                  <span className="text-[10px] font-mono">{item.sort_order}</span>
                  <button
                    onClick={() => moveItem(item, 'down')}
                    disabled={idx === sectionItems.length - 1}
                    className="leading-none hover:text-slate-600 disabled:opacity-20"
                    title="Move down"
                  >
                    ▼
                  </button>
                </div>

                {/* Label + meta */}
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug text-slate-800">{item.label}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[item.answer_type]}`}
                    >
                      {ANSWER_TYPES.find((t) => t.value === item.answer_type)?.label}
                    </span>
                    {item.requested_value && item.requested_value !== '—' && (
                      <span className="text-xs text-slate-400">
                        Requested: {item.requested_value}
                      </span>
                    )}
                    {!item.allow_comment && (
                      <span className="text-xs text-slate-400">No comment field</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      editingId === item.id ? setEditingId(null) : startEdit(item)
                    }
                  >
                    {editingId === item.id ? 'Cancel' : 'Edit'}
                  </Button>
                  <Button variant="danger" onClick={() => archiveItem(item)}>
                    Remove
                  </Button>
                </div>
              </div>

              {/* Inline edit form */}
              {editingId === item.id && (
                <div className="border-t border-[#E5D5C8] bg-[#F5EFE8] px-6 py-4">
                  <ItemForm value={editState} onChange={setEditState} uid={item.id} />
                  <div className="mt-4 flex gap-2">
                    <Button onClick={saveEdit} disabled={saving || !editState.label.trim()}>
                      {saving ? 'Saving…' : 'Save changes'}
                    </Button>
                    <Button variant="secondary" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Add item footer */}
        <div className="border-t border-slate-200 px-4 py-4">
          {!showAdd ? (
            <Button
              variant="secondary"
              onClick={() => {
                setShowAdd(true)
                setAddState(blankEdit())
                setEditingId(null)
              }}
            >
              + Add item to {SECTIONS.find((s) => s.key === activeSection)?.label}
            </Button>
          ) : (
            <div>
              <p className="mb-4 text-sm font-medium text-slate-700">
                New item in{' '}
                <span className="text-[#1C1008]">
                  {SECTIONS.find((s) => s.key === activeSection)?.label}
                </span>
              </p>
              <ItemForm value={addState} onChange={setAddState} uid="new" />
              <div className="mt-4 flex gap-2">
                <Button onClick={addItem} disabled={adding || !addState.label.trim()}>
                  {adding ? 'Adding…' : 'Add item'}
                </Button>
                <Button variant="secondary" onClick={() => setShowAdd(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
