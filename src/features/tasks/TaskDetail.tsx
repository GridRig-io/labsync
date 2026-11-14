import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, X } from 'lucide-react'
import { supabase, q, friendlyError } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { useToast } from '../../lib/toast'
import { usePeopleMap } from '../../lib/data'
import type { Task, TaskStatus } from '../../lib/types'
import { TaskSheet } from './sheets'
import { Avatar, CheckBox, ErrorNote, PageHead, Section, Seg, SkeletonRows, Tag } from '../../components/ui'
import { fmtDateTime, PRIORITY, relTime, TASK_STATUS } from '../../lib/format'

export default function TaskDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { profile, can } = useSession()
  const toast = useToast()
  const qc = useQueryClient()
  const people = usePeopleMap()
  const [edit, setEdit] = useState(false)
  const [line, setLine] = useState('')
  const [comment, setComment] = useState('')
  const { data: t, error, refetch } = useQuery({
    queryKey: ['tasks', 'one', id],
    queryFn: () => q<Task & { items: { name: string } | null; equipment: { name: string } | null; blood_units: { unit_number: string } | null }>(
      supabase.from('tasks').select('*, items(name), equipment(name), blood_units(unit_number)').eq('id', id!).single()),
  })
  const { data: checklist = [] } = useQuery({
    queryKey: ['tasks', 'checklist', id],
    queryFn: () => q<{ id: string; label: string; done: boolean; sort_order: number }[]>(supabase.from('task_checklist_items').select('*').eq('task_id', id!).order('sort_order')),
  })
  const { data: comments = [] } = useQuery({
    queryKey: ['tasks', 'comments', id],
    queryFn: () => q<{ id: string; author_id: string; body: string; created_at: string }[]>(supabase.from('task_comments').select('*').eq('task_id', id!).order('created_at')),
  })
  if (error) return <ErrorNote error={error} retry={refetch} />
  if (!t) return <SkeletonRows n={6} />

  const mayEdit = can('tasks.assign') || t.assignee_id === profile?.id || t.created_by === profile?.id
  const refresh = () => { qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['today'] }) }
  const run = async (p: PromiseLike<{ error: unknown }>, msg?: string) => {
    const { error } = await p
    if (error) toast(friendlyError(error), { tone: 'error' }); else { refresh(); if (msg) toast(msg) }
  }
  const setStatus = (s: TaskStatus) => run(supabase.from('tasks').update({ status: s }).eq('id', t.id), s === 'completed' ? `Done${t.recurrence ? ' · next one scheduled' : ''}` : undefined)
  const addLine = async () => { if (!line.trim()) return; await run(supabase.from('task_checklist_items').insert({ task_id: t.id, label: line.trim(), sort_order: checklist.length })); setLine('') }
  const addComment = async () => { if (!comment.trim()) return; await run(supabase.from('task_comments').insert({ task_id: t.id, body: comment.trim(), author_id: profile!.id })); setComment('') }
  const del = async () => {
    if (!confirm('Delete this task?')) return
    const { error } = await supabase.from('tasks').delete().eq('id', t.id)
    if (error) toast(friendlyError(error), { tone: 'error' }); else { refresh(); toast('Task deleted'); nav('/tasks') }
  }
  const done = checklist.filter((c) => c.done).length

  return (
    <>
      <PageHead crumb={<Link to="/tasks" className="crumb"><ChevronLeft size={14} /> Tasks</Link>}
        kicker={`${PRIORITY[t.priority].label} priority${t.recurrence ? ` · repeats ${t.recurrence}` : ''}`}
        title={<span className={t.status === 'completed' ? 'done-text' : ''}>{t.title}</span>}
        actions={mayEdit ? <><button className="btn sm" onClick={() => setEdit(true)}>Edit</button>{(can('tasks.assign') || t.created_by === profile?.id) && <button className="btn sm ghost" onClick={del}>Delete</button>}</> : undefined} />

      {mayEdit && (
        <div style={{ marginBottom: 24 }}>
          <Seg full value={t.status === 'delayed' ? 'pending' : t.status} onChange={setStatus} options={[
            { value: 'pending', label: t.status === 'delayed' ? 'Overdue' : 'To do' }, { value: 'in_progress', label: 'In progress' }, { value: 'completed', label: 'Done' }]} />
        </div>
      )}

      <div className="grid-2">
        <div>
          {t.description && <Section title="Details"><p style={{ padding: '12px 0', whiteSpace: 'pre-wrap' }}>{t.description}</p></Section>}
          <Section title={`Checklist${checklist.length ? ` · ${done}/${checklist.length}` : ''}`}>
            <ul className="ledger">
              {checklist.map((c) => (
                <li key={c.id} className="row" style={{ gridTemplateColumns: '26px minmax(0,1fr) auto' }}>
                  <CheckBox on={c.done} onToggle={() => mayEdit && run(supabase.from('task_checklist_items').update({ done: !c.done }).eq('id', c.id))} label={c.label} />
                  <span className={c.done ? 'done-text' : ''}>{c.label}</span>
                  {mayEdit ? <button className="icon-btn" aria-label="Remove step" onClick={() => run(supabase.from('task_checklist_items').delete().eq('id', c.id))}><X size={16} /></button> : <span />}
                </li>
              ))}
            </ul>
            {mayEdit && <input className="input" style={{ marginTop: 8 }} placeholder="Add a step, press Enter" value={line} onChange={(e) => setLine(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addLine()} />}
          </Section>
          <Section title={`Comments · ${comments.length}`}>
            <ul className="ledger">
              {comments.map((c) => (
                <li key={c.id} className="row no-mark" style={{ gridTemplateColumns: '28px minmax(0,1fr)', alignItems: 'start' }}>
                  <Avatar name={people.get(c.author_id)?.full_name} />
                  <div>
                    <div className="small"><b>{people.get(c.author_id)?.full_name ?? '—'}</b> <span className="faint">{relTime(c.created_at)}</span></div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="hstack" style={{ marginTop: 8, flexWrap: 'nowrap' }}>
              <input className="input" placeholder="Write a comment" value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addComment()} />
              <button className="btn" onClick={addComment} disabled={!comment.trim()}>Post</button>
            </div>
          </Section>
        </div>
        <Section title="Info">
          <dl className="spec">
            <dt>Status</dt><dd><Tag tone={TASK_STATUS[t.status].tone}>{TASK_STATUS[t.status].label}</Tag></dd>
            <dt>Assigned to</dt><dd className="hstack">{t.assignee_id ? <><Avatar name={people.get(t.assignee_id)?.full_name} />{people.get(t.assignee_id)?.full_name}</> : 'Unassigned'}</dd>
            <dt>Due</dt><dd>{t.due_at ? fmtDateTime(t.due_at) : '—'}</dd>
            <dt>Created by</dt><dd>{people.get(t.created_by ?? '')?.full_name ?? '—'} · {relTime(t.created_at)}</dd>
            {t.completed_at && <><dt>Completed</dt><dd>{fmtDateTime(t.completed_at)}</dd></>}
            {t.items && <><dt>Item</dt><dd><Link to={`/inventory/${t.linked_item_id}`}>{t.items.name}</Link></dd></>}
            {t.equipment && <><dt>Equipment</dt><dd><Link to={`/equipment/${t.linked_equipment_id}`}>{t.equipment.name}</Link></dd></>}
            {t.blood_units && <><dt>Blood unit</dt><dd><Link to={`/blood/${t.linked_blood_unit_id}`} className="mono">{t.blood_units.unit_number}</Link></dd></>}
          </dl>
        </Section>
      </div>
      {edit && <TaskSheet taskId={t.id} onClose={() => setEdit(false)} />}
    </>
  )
}
