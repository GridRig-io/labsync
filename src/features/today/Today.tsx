import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, q, friendlyError } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { useActions } from '../../lib/actions'
import { useToast } from '../../lib/toast'
import { usePeopleMap } from '../../lib/data'
import type { Activity, BloodSummary, Component, Equipment, Task, Tone } from '../../lib/types'
import { Mark, Section, SkeletonRows, CheckBox, Tag, Chips } from '../../components/ui'
import { useColdStatus } from '../equipment/sheets'
import { useInventory } from '../inventory/sheets'
import {
  COMPONENTS, COMPONENT_SHORT, daysUntil, firstName, fmtDate, greeting, GROUPS, groupLabel, relTime, todayISO, addDaysISO,
  num, PRIORITY, fmtTime,
} from '../../lib/format'

export function useBloodSummary() {
  return useQuery({ queryKey: ['blood', 'summary'], queryFn: () => q<BloodSummary[]>(supabase.from('blood_stock_summary').select('*')) })
}

export function BloodStrip({ summary, component }: { summary: BloodSummary[]; component: Component }) {
  return (
    <div className="blood-strip">
      {GROUPS.map((g) => {
        const s = summary.find((x) => x.abo === g.abo && x.rh === g.rh && x.component === component)
        const low = !!s?.below_minimum
        return (
          <Link key={groupLabel(g.abo, g.rh)} to={`/blood?group=${g.abo}${g.rh}&component=${component}&status=available`} className={`btile ${low ? 'low' : ''}`}
            aria-label={`${groupLabel(g.abo, g.rh)}: ${s?.available_units ?? 0} available, minimum ${s?.min_units ?? 0}${low ? ', below minimum' : ''}`}>
            <span className="grp">{groupLabel(g.abo, g.rh)}</span>
            {low && <span className="flag"><Mark tone="critical" title="Below minimum" /></span>}
            <span className="cnt">{String(s?.available_units ?? 0).padStart(2, '0')}</span>
            <span className="min">min {s?.min_units ?? 0}{s?.quarantine_units ? ` · ${s.quarantine_units}Q` : ''}</span>
          </Link>
        )
      })}
    </div>
  )
}

interface Attn { tone: Tone; title: string; sub?: string; action: string; go: () => void }

export function Today() {
  const { profile, lab, can } = useSession()
  const { open } = useActions()
  const nav = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const people = usePeopleMap()
  const [component, setComponent] = useState<Component>('packed_red_cells')
  const warn = lab?.expiry_warning_days ?? 30
  const bWarn = lab?.blood_expiry_warning_days ?? 3

  const { data: summary } = useBloodSummary()
  const { data: inv } = useInventory()
  const { data: cold } = useColdStatus()
  const { data: blood } = useQuery({
    queryKey: ['today', 'blood-flags'],
    queryFn: () => q<{ id: string; status: string; expiry_date: string }[]>(supabase.from('blood_units').select('id,status,expiry_date')
      .or(`status.eq.expired,and(status.eq.available,expiry_date.lte.${addDaysISO(todayISO(), bWarn)})`)),
  })
  const { data: equip } = useQuery({
    queryKey: ['today', 'equip-due'],
    queryFn: () => q<Equipment[]>(supabase.from('equipment').select('*').neq('status', 'retired')
      .or(`next_service_date.lte.${addDaysISO(todayISO(), 7)},next_calibration_date.lte.${addDaysISO(todayISO(), 7)},status.eq.out_of_service`)),
  })
  const { data: myTasks, isLoading: tLoading } = useQuery({
    queryKey: ['today', 'my-tasks', profile?.id],
    queryFn: () => q<Task[]>(supabase.from('tasks').select('*, task_checklist_items(id,done)').eq('assignee_id', profile!.id)
      .in('status', ['pending', 'in_progress', 'delayed']).or(`due_at.is.null,due_at.lte.${addDaysISO(todayISO(), 1)}T00:00:00`)
      .order('due_at', { ascending: true, nullsFirst: false }).limit(6)),
    enabled: !!profile,
  })
  const { data: openTasks } = useQuery({
    queryKey: ['today', 'open-count'],
    queryFn: async () => (await supabase.from('tasks').select('id', { count: 'exact', head: true }).in('status', ['pending', 'in_progress', 'delayed'])).count ?? 0,
  })
  const { data: activity } = useQuery({
    queryKey: ['today', 'activity'],
    queryFn: () => q<Activity[]>(supabase.from('activity_feed').select('*').order('created_at', { ascending: false }).limit(10)),
  })

  // ---------- build the "needs attention" register ----------
  const attn: Attn[] = []
  if (summary) {
    const low = summary.filter((s) => s.below_minimum)
    if (low.length) attn.push({
      tone: 'critical', title: `${low.length} blood ${low.length === 1 ? 'line' : 'lines'} below minimum`,
      sub: low.slice(0, 4).map((s) => `${groupLabel(s.abo, s.rh)} ${COMPONENT_SHORT[s.component]} ${s.available_units}/${s.min_units}`).join(' · ') + (low.length > 4 ? ' …' : ''),
      action: 'View', go: () => nav('/blood'),
    })
  }
  const expiredBlood = blood?.filter((b) => b.status === 'expired').length ?? 0
  if (expiredBlood) attn.push({ tone: 'critical', title: `${expiredBlood} expired blood ${expiredBlood === 1 ? 'unit' : 'units'} to discard`, action: 'Review', go: () => nav('/blood?status=expired') })
  cold?.filter((c) => c.last_out_of_range).forEach((c) => attn.push({ tone: 'critical', title: `${c.name} out of range: ${num(c.last_reading_c)} °C`, sub: `Allowed ${c.temp_min_c} to ${c.temp_max_c} °C · ${relTime(c.last_recorded_at)}`, action: 'Re-check', go: () => open({ kind: 'temp', equipmentId: c.id }) }))
  const overdueMine = myTasks?.filter((t) => t.status === 'delayed' || (t.due_at && new Date(t.due_at) < new Date())).length ?? 0
  if (overdueMine) attn.push({ tone: 'critical', title: `${overdueMine} of your tasks overdue`, action: 'Open', go: () => nav('/tasks?view=mine') })
  if (inv) {
    const expired = inv.filter((i) => i.stock_status === 'expired').length
    const out = inv.filter((i) => i.stock_status === 'out_of_stock' && i.par_level > 0).length
    const low = inv.filter((i) => i.stock_status === 'low_stock').length
    if (expired) attn.push({ tone: 'critical', title: `${expired} ${expired === 1 ? 'item has' : 'items have'} expired stock on the shelf`, sub: 'Discard or quarantine expired lots', action: 'View', go: () => nav('/inventory?status=expired') })
    if (out) attn.push({ tone: 'critical', title: `${out} ${out === 1 ? 'item' : 'items'} out of stock`, action: 'View', go: () => nav('/inventory?status=out_of_stock') })
    if (low) attn.push({ tone: 'warning', title: `${low} ${low === 1 ? 'item' : 'items'} below par`, sub: 'Time to reorder', action: 'View', go: () => nav('/inventory?status=low_stock') })
  }
  const due = cold?.filter((c) => c.reading_due && !c.last_out_of_range) ?? []
  if (due.length) attn.push({ tone: 'warning', title: `Temperature round due · ${due.length} ${due.length === 1 ? 'unit' : 'units'}`, sub: due.map((d) => d.name).join(' · '), action: 'Log', go: () => open({ kind: 'temp', equipmentId: due.length === 1 ? due[0]!.id : undefined }) })
  equip?.forEach((e) => {
    const d = Math.min(daysUntil(e.next_service_date) ?? 999, daysUntil(e.next_calibration_date) ?? 999)
    const what = (daysUntil(e.next_calibration_date) ?? 999) <= (daysUntil(e.next_service_date) ?? 999) ? 'calibration' : 'service'
    if (e.status === 'out_of_service') attn.push({ tone: 'critical', title: `${e.name} is out of service`, action: 'Open', go: () => nav(`/equipment/${e.id}`) })
    else attn.push({ tone: d < 0 ? 'critical' : 'warning', title: `${e.name} ${what} ${d < 0 ? `overdue ${-d}d` : d === 0 ? 'due today' : `due in ${d}d`}`, action: 'Open', go: () => nav(`/equipment/${e.id}`) })
  })
  const bExp = blood?.filter((b) => b.status === 'available').length ?? 0
  if (bExp) attn.push({ tone: 'warning', title: `${bExp} blood ${bExp === 1 ? 'unit expires' : 'units expire'} within ${bWarn} days`, sub: 'Use these first', action: 'View', go: () => nav('/blood?status=available&expiring=1') })
  const lotsSoon = inv?.filter((i) => i.stock_status !== 'expired' && i.nearest_expiry && (daysUntil(i.nearest_expiry) ?? 99) <= Math.min(warn, 14)).length ?? 0
  if (lotsSoon) attn.push({ tone: 'warning', title: `${lotsSoon} ${lotsSoon === 1 ? 'item has a lot' : 'items have lots'} expiring within ${Math.min(warn, 14)} days`, action: 'View', go: () => nav('/inventory?status=expiring') })
  attn.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'critical' ? -1 : 1))

  const loading = !summary || !inv || !cold
  const belowPar = inv?.filter((i) => i.stock_status === 'low_stock' || (i.stock_status === 'out_of_stock' && i.par_level > 0)).length ?? 0
  const expiring = inv?.filter((i) => i.nearest_expiry && (daysUntil(i.nearest_expiry) ?? 999) <= warn).length ?? 0
  const eqDue = equip?.length ?? 0

  const complete = async (t: Task) => {
    try {
      await q(supabase.from('tasks').update({ status: 'completed' }).eq('id', t.id))
      qc.invalidateQueries({ queryKey: ['today'] }); qc.invalidateQueries({ queryKey: ['tasks'] })
      toast(`Done: ${t.title}`, { undo: async () => { await supabase.from('tasks').update({ status: 'pending' }).eq('id', t.id); qc.invalidateQueries({ queryKey: ['today'] }) } })
    } catch (e) { toast(friendlyError(e), { tone: 'error' }) }
  }

  const now = new Date()
  return (
    <>
      <header className="page-head">
        <div>
          <div className="label kicker">{fmtDate(now)} · {fmtTime(now)}</div>
          <h1 className="title-xl">{greeting()}, {firstName(profile?.full_name)}</h1>
        </div>
        <div className="actions only-desktop">
          {can('stock.consume') && <button className="btn primary" onClick={() => open({ kind: 'use' })}>Use stock</button>}
          <button className="btn" onClick={() => open({ kind: 'temp' })}>Log temperature</button>
          {can('blood.write') && <button className="btn" onClick={() => open({ kind: 'blood-add' })}>Add blood unit</button>}
        </div>
      </header>

      <div className="grid-2">
        <div>
          <Section title="Needs attention" count={loading ? undefined : attn.length}>
            {loading ? <SkeletonRows n={3} /> : attn.length === 0 ? (
              <div className="all-clear"><Mark tone="ok" /><div><b>All clear.</b> <span className="muted">Nothing needs action right now.</span></div></div>
            ) : (
              <div>
                {attn.map((a, i) => (
                  <div key={i} className={`attn ${a.tone}`}>
                    <Mark tone={a.tone} />
                    <div style={{ minWidth: 0 }}>
                      <div className="t">{a.title}</div>
                      {a.sub && <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.sub}</div>}
                    </div>
                    <button className={`btn sm ${a.tone === 'critical' ? 'primary' : ''}`} onClick={a.go}>{a.action}</button>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="My tasks today" action={<Link to="/tasks?view=mine">All tasks →</Link>}>
            {tLoading ? <SkeletonRows n={2} /> : !myTasks?.length ? (
              <div className="empty"><p className="muted">Nothing assigned to you for today.</p>
                <button className="btn sm" onClick={() => open({ kind: 'task' })}>New task</button></div>
            ) : (
              <ul className="ledger">
                {myTasks.map((t) => {
                  const done = t.task_checklist_items?.filter((c) => c.done).length ?? 0
                  const total = t.task_checklist_items?.length ?? 0
                  const late = t.status === 'delayed' || (t.due_at && new Date(t.due_at) < now)
                  return (
                    <li key={t.id}>
                      <Link to={`/tasks/${t.id}`} className="row" style={{ gridTemplateColumns: '26px minmax(0,1fr) auto' }}>
                        <CheckBox on={false} onToggle={() => complete(t)} label={`Complete ${t.title}`} />
                        <span style={{ minWidth: 0 }}>
                          <span className="main-line" style={{ display: 'block' }}>{t.title}</span>
                          <span className="sub-line" style={{ display: 'block' }}>
                            {t.due_at ? <span className={late ? 'c-red' : ''}>{late ? 'Overdue · ' : ''}{fmtTime(t.due_at)}</span> : 'No time set'}
                            {total > 0 && <span className="mono"> · {done}/{total}</span>}
                          </span>
                        </span>
                        <span className="end"><Tag tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Tag></span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </Section>
        </div>

        <div>
          <Section title="Blood stock · available" action={<Link to="/blood">Blood bank →</Link>}>
            <div style={{ padding: '10px 0' }}>
              <Chips value={component} onChange={setComponent} options={COMPONENTS.map((c) => ({ value: c, label: COMPONENT_SHORT[c] }))} />
            </div>
            {summary ? <BloodStrip summary={summary} component={component} /> : <SkeletonRows n={2} />}
          </Section>

          <Section title="Counts">
            <div className="counters">
              <Link to="/inventory?status=low_stock" className={`counter ${belowPar ? 'alert' : ''}`}><span className="label">Below par</span><span className="big-num">{loading ? '–' : belowPar}</span></Link>
              <Link to="/inventory?status=expiring" className="counter"><span className="label">Expiring ≤{warn}d</span><span className="big-num">{loading ? '–' : expiring}</span></Link>
              <Link to="/tasks" className="counter"><span className="label">Open tasks</span><span className="big-num">{openTasks ?? '–'}</span></Link>
              <Link to="/equipment" className={`counter ${equip?.some((e) => Math.min(daysUntil(e.next_service_date) ?? 9, daysUntil(e.next_calibration_date) ?? 9) < 0) ? 'alert' : ''}`}><span className="label">Equip. due ≤7d</span><span className="big-num">{equip ? eqDue : '–'}</span></Link>
            </div>
          </Section>

          <Section title="Recent activity">
            {!activity ? <SkeletonRows n={4} /> : activity.length === 0 ? <p className="muted" style={{ padding: '14px 0' }}>Activity appears here as your team records work.</p> : (
              <ul className="ledger">
                {activity.map((a) => (
                  <li key={`${a.kind}-${a.id}`}>
                    <Link to={a.link} className="row no-mark" style={{ minHeight: 44 }}>
                      <span style={{ minWidth: 0 }}>
                        <span className="small" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <ActivityText a={a} />
                        </span>
                        <span className="sub-line" style={{ display: 'block', fontSize: '0.78rem' }}>{people.get(a.actor_id ?? '')?.full_name ?? 'System'} · {relTime(a.created_at)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </>
  )
}

function ActivityText({ a }: { a: Activity }) {
  const qty = a.qty != null ? <span className="mono">{a.qty > 0 && a.kind === 'stock' ? '+' : ''}{num(a.qty)}{a.unit === '°C' ? '°C' : ` ${a.unit}`}</span> : null
  const verbs: Record<string, string> = {
    receive: 'Received', consume: 'Used', adjust: 'Adjusted', discard: 'Discarded', return: 'Returned', transfer: 'Moved',
    quarantine: 'Quarantined', available: 'Released', reserved: 'Reserved', issued: 'Issued', discarded: 'Discarded', expired: 'Expired',
    completed: 'Completed', reading: 'Logged', out_of_range: 'Out of range',
  }
  if (a.kind === 'temperature') return <>{a.action === 'out_of_range' ? <b className="c-red">{verbs[a.action]}</b> : <b>{verbs[a.action]}</b>} {a.subject} · {qty}</>
  return <><b>{verbs[a.action] ?? a.action}</b> {qty} {a.subject}</>
}
