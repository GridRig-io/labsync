import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, MessageSquare } from 'lucide-react'
import { supabase, q, friendlyError } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { useActions } from '../../lib/actions'
import { useToast } from '../../lib/toast'
import { usePeopleMap } from '../../lib/data'
import type { Task, TaskStatus } from '../../lib/types'
import { Avatar, CheckBox, Empty, ErrorNote, Mark, PageHead, Section, Seg, SkeletonRows, Tag } from '../../components/ui'
import { fmtShort, fmtTime, PRIORITY, TASK_STATUS, todayISO } from '../../lib/format'

function useTasks(scope: 'mine' | 'team', uid?: string) {
  return useQuery({
    queryKey: ['tasks', 'list', scope, uid],
    queryFn: () => {
      let qy = supabase.from('tasks').select('*, task_checklist_items(id,done), task_comments(count)')
        .or(`status.neq.completed,completed_at.gte.${new Date(Date.now() - 3 * 86400000).toISOString()}`).neq('status', 'cancelled')
      if (scope === 'mine') qy = qy.eq('assignee_id', uid!)
      return q<Task[]>(qy.order('due_at', { ascending: true, nullsFirst: false }).limit(300))
    },
    enabled: scope === 'team' || !!uid,
  })
}

export function TaskRow({ t, onDone }: { t: Task; onDone: (t: Task, done: boolean) => void }) {
  const people = usePeopleMap()
  const done = t.status === 'completed'
  const cl = t.task_checklist_items ?? []
  const comments = t.task_comments?.[0]?.count ?? 0
  const late = !done && (t.status === 'delayed' || (t.due_at && new Date(t.due_at) < new Date()))
  return (
    <li>
      <Link to={`/tasks/${t.id}`} className="row" style={{ gridTemplateColumns: '26px minmax(0,1fr) auto' }}>
        <CheckBox on={done} onToggle={() => onDone(t, !done)} label={done ? `Reopen ${t.title}` : `Complete ${t.title}`} />
        <span style={{ minWidth: 0 }}>
          <span className={`main-line ${done ? 'done-text' : ''}`} style={{ display: 'block' }}>{t.title}</span>
          <span className="sub-line" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {t.due_at && <span className={late ? 'c-red' : ''}>{late ? 'Overdue · ' : ''}{t.due_at.slice(0, 10) === todayISO() ? fmtTime(t.due_at) : fmtShort(t.due_at)}</span>}
            {cl.length > 0 && <span className="mono">{cl.filter((c) => c.done).length}/{cl.length}</span>}
            {comments > 0 && <span className="hstack" style={{ gap: 3 }}><MessageSquare size={12} />{comments}</span>}
            {t.recurrence && <span>↻ {t.recurrence}</span>}
          </span>
        </span>
        <span className="end">
          {!done && t.priority !== 'medium' && <Tag tone={PRIORITY[t.priority].tone} solid={t.priority === 'critical'}>{PRIORITY[t.priority].label}</Tag>}
          {t.assignee_id && <span title={people.get(t.assignee_id)?.full_name ?? ''}><Avatar name={people.get(t.assignee_id)?.full_name} /></span>}
        </span>
      </Link>
    </li>
  )
}

export function useCompleteTask() {
  const qc = useQueryClient()
  const toast = useToast()
  return async (t: Task, done: boolean) => {
    try {
      await q(supabase.from('tasks').update({ status: done ? 'completed' : 'pending' }).eq('id', t.id))
      qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['today'] })
      if (done) toast(`Done: ${t.title}${t.recurrence ? ' · next one scheduled' : ''}`, {
        undo: t.recurrence ? undefined : async () => { await supabase.from('tasks').update({ status: 'pending' }).eq('id', t.id); qc.invalidateQueries({ queryKey: ['tasks'] }) },
      })
    } catch (e) { toast(friendlyError(e), { tone: 'error' }) }
  }
}

export default function Tasks() {
  const { profile } = useSession()
  const { open } = useActions()
  const [params, setParams] = useSearchParams()
  const scope = (params.get('view') as 'mine' | 'team') || 'team'
  const [layout, setLayout] = useState<'list' | 'board'>('list')
  const { data, isLoading, error, refetch } = useTasks(scope, profile?.id)
  const complete = useCompleteTask()

  const tasks = data ?? []
  const today = todayISO()
  const now = Date.now()
  const groups: { title: string; tone: 'critical' | 'neutral'; items: Task[] }[] = [
    { title: 'Overdue', tone: 'critical', items: tasks.filter((t) => t.status !== 'completed' && (t.status === 'delayed' || (t.due_at && new Date(t.due_at).getTime() < now))) },
    { title: 'Today', tone: 'neutral', items: tasks.filter((t) => t.status !== 'completed' && t.status !== 'delayed' && t.due_at && t.due_at.slice(0, 10) <= today && new Date(t.due_at).getTime() >= now) },
    { title: 'Upcoming', tone: 'neutral', items: tasks.filter((t) => t.status !== 'completed' && t.status !== 'delayed' && t.due_at && t.due_at.slice(0, 10) > today) },
    { title: 'No date', tone: 'neutral', items: tasks.filter((t) => t.status !== 'completed' && t.status !== 'delayed' && !t.due_at) },
    { title: 'Done recently', tone: 'neutral', items: tasks.filter((t) => t.status === 'completed') },
  ]

  return (
    <>
      <PageHead kicker="05 · Tasks" title="Tasks" actions={<button className="btn primary" onClick={() => open({ kind: 'task' })}><Plus size={16} /> New task</button>} />
      <div className="toolbar">
        <Seg value={scope} onChange={(v) => setParams(v === 'team' ? {} : { view: v })} options={[{ value: 'mine', label: 'Mine' }, { value: 'team', label: 'Team' }]} />
        <span className="only-desktop"><Seg value={layout} onChange={setLayout} options={[{ value: 'list', label: 'List' }, { value: 'board', label: 'Board' }]} /></span>
      </div>
      {error ? <ErrorNote error={error} retry={refetch} /> : isLoading ? <SkeletonRows n={6} /> : tasks.length === 0 ? (
        <Empty text={scope === 'mine' ? 'No tasks assigned to you.' : 'No tasks yet.'} action={<button className="btn primary sm" onClick={() => open({ kind: 'task' })}>Create a task</button>} />
      ) : layout === 'board' && window.matchMedia('(min-width: 900px)').matches ? (
        <Board tasks={tasks} />
      ) : (
        groups.filter((g) => g.items.length).map((g) => (
          <Section key={g.title} title={g.title} count={g.items.length}>
            <ul className="ledger">{g.items.map((t) => <TaskRow key={t.id} t={t} onDone={complete} />)}</ul>
          </Section>
        ))
      )}
    </>
  )
}

function Board({ tasks }: { tasks: Task[] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const people = usePeopleMap()
  const cols: TaskStatus[] = ['pending', 'in_progress', 'delayed', 'completed']
  const [over, setOver] = useState<string | null>(null)
  const move = async (id: string, status: TaskStatus) => {
    try { await q(supabase.from('tasks').update({ status }).eq('id', id)); qc.invalidateQueries({ queryKey: ['tasks'] }) }
    catch (e) { toast(friendlyError(e), { tone: 'error' }) }
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 16 }}>
      {cols.map((c) => (
        <div key={c} onDragOver={(e) => { e.preventDefault(); setOver(c) }} onDragLeave={() => setOver(null)}
          onDrop={(e) => { setOver(null); move(e.dataTransfer.getData('text/plain'), c) }}
          style={{ background: over === c ? 'var(--tint)' : undefined, minHeight: 300 }}>
          <div className="sec-head"><span className="label">{TASK_STATUS[c].label} · {tasks.filter((t) => t.status === c).length}</span></div>
          {tasks.filter((t) => t.status === c).map((t) => (
            <Link key={t.id} to={`/tasks/${t.id}`} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
              className="panel" style={{ display: 'block', marginTop: 8, textDecoration: 'none', borderLeft: `3px solid var(--${PRIORITY[t.priority].tone === 'critical' ? 'red' : PRIORITY[t.priority].tone === 'warning' ? 'amber' : PRIORITY[t.priority].tone === 'info' ? 'blue' : 'rule-2'})`, cursor: 'grab' }}>
              <div style={{ fontWeight: 500 }} className={c === 'completed' ? 'done-text' : ''}>{t.title}</div>
              <div className="spread small muted" style={{ marginTop: 8 }}>
                <span className="hstack"><Mark tone={PRIORITY[t.priority].tone} />{t.due_at ? fmtShort(t.due_at) : 'No date'}</span>
                {t.assignee_id && <Avatar name={people.get(t.assignee_id)?.full_name} />}
              </div>
            </Link>
          ))}
        </div>
      ))}
    </div>
  )
}
