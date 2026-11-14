import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { supabase, q, friendlyError } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { useToast } from '../../lib/toast'
import { usePeople } from '../../lib/data'
import type { Priority, Task } from '../../lib/types'
import { Field, Seg, Sheet } from '../../components/ui'
import { todayISO } from '../../lib/format'

function localParts(iso: string | null) {
  if (!iso) return { date: '', time: '' }
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }
}

export function TaskSheet({ taskId, preset, onClose, onSaved }: { taskId?: string; preset?: Record<string, string>; onClose: () => void; onSaved?: (id: string) => void }) {
  const { profile, can } = useSession()
  const toast = useToast()
  const qc = useQueryClient()
  const { data: people = [] } = usePeople()
  const { data: existing } = useQuery({
    queryKey: ['tasks', 'one', taskId], enabled: !!taskId,
    queryFn: () => q<Task>(supabase.from('tasks').select('*').eq('id', taskId!).single()),
  })
  const [f, setF] = useState({
    title: preset?.title ?? '', description: '', priority: 'medium' as Priority, date: '', time: '',
    assignee_id: profile?.id ?? '', recurrence: '',
  })
  const [checklist, setChecklist] = useState<string[]>([])
  const [line, setLine] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (existing) {
      const p = localParts(existing.due_at)
      setF({ title: existing.title, description: existing.description ?? '', priority: existing.priority, date: p.date, time: p.time, assignee_id: existing.assignee_id ?? '', recurrence: existing.recurrence ?? '' })
    }
  }, [existing])
  const canAssign = can('tasks.assign')
  const assignees = canAssign ? people.filter((p) => p.is_active) : people.filter((p) => p.id === profile?.id)

  const save = async () => {
    if (!f.title.trim()) return toast('Give the task a title', { tone: 'error' })
    setBusy(true)
    const due_at = f.date ? new Date(`${f.date}T${f.time || '17:00'}`).toISOString() : null
    const row = {
      title: f.title.trim(), description: f.description.trim() || null, priority: f.priority, due_at,
      assignee_id: f.assignee_id || null, recurrence: f.recurrence || null,
      ...(taskId ? {} : {
        linked_item_id: preset?.linked_item_id ?? null, linked_equipment_id: preset?.linked_equipment_id ?? null,
        linked_blood_unit_id: preset?.linked_blood_unit_id ?? null,
      }),
    }
    try {
      const r = taskId ? await q<{ id: string }>(supabase.from('tasks').update(row).eq('id', taskId).select('id').single())
        : await q<{ id: string }>(supabase.from('tasks').insert(row).select('id').single())
      const lines = [...checklist, line].map((s) => s.trim()).filter(Boolean)
      if (!taskId && lines.length) await q(supabase.from('task_checklist_items').insert(lines.map((label, i) => ({ task_id: r.id, label, sort_order: i }))))
      qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['today'] })
      toast(taskId ? 'Task updated' : 'Task created'); onSaved?.(r.id); onClose()
    } catch (e) { toast(friendlyError(e), { tone: 'error' }) } finally { setBusy(false) }
  }

  return (
    <Sheet open onClose={onClose} title={taskId ? 'Edit task' : 'New task'}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save task'}</button></>}>
      <Field label="Task *" htmlFor="t-title"><input id="t-title" className="input" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Run daily QC on haematology analyser" /></Field>
      <Field label="Priority"><Seg full value={f.priority} onChange={(priority) => setF({ ...f, priority })} options={[
        { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'critical', label: 'Critical' }]} /></Field>
      <div className="row-fields">
        <Field label="Due date" htmlFor="t-date"><input id="t-date" type="date" className="input" min={taskId ? undefined : todayISO()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Time" htmlFor="t-time"><input id="t-time" type="time" className="input" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
      </div>
      <div className="row-fields">
        <Field label="Assigned to" htmlFor="t-who" hint={canAssign ? undefined : 'You can create tasks for yourself'}>
          <select id="t-who" className="select" value={f.assignee_id} onChange={(e) => setF({ ...f, assignee_id: e.target.value })}>
            <option value="">Unassigned</option>{assignees.map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.id === profile?.id ? ' (me)' : ''}</option>)}
          </select></Field>
        <Field label="Repeats" htmlFor="t-rep"><select id="t-rep" className="select" value={f.recurrence} onChange={(e) => setF({ ...f, recurrence: e.target.value })}>
          <option value="">Never</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></Field>
      </div>
      <Field label="Details" htmlFor="t-desc"><textarea id="t-desc" className="textarea" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      {!taskId && (
        <Field label="Checklist">
          {checklist.map((c, i) => (
            <div key={i} className="spread" style={{ borderBottom: '1px solid var(--rule)', padding: '6px 0' }}>
              <span>{c}</span><button className="icon-btn" onClick={() => setChecklist(checklist.filter((_, j) => j !== i))} aria-label="Remove"><X size={16} /></button>
            </div>
          ))}
          <input className="input" value={line} placeholder="Add a step, press Enter" onChange={(e) => setLine(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && line.trim()) { e.preventDefault(); setChecklist([...checklist, line.trim()]); setLine('') } }} />
        </Field>
      )}
    </Sheet>
  )
}
