import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'
import { supabase, q } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { useActions } from '../../lib/actions'
import { useLocations, usePeopleMap } from '../../lib/data'
import type { BloodUnit } from '../../lib/types'
import { BloodActionSheet, SCREENS, type BloodAction } from './sheets'
import { ErrorNote, Expiry, IdChip, Mark, Section, SkeletonRows, Tag } from '../../components/ui'
import { BLOOD_STATUS, COMPONENT_LABEL, fmtDate, fmtDateTime, groupLabel } from '../../lib/format'

export default function UnitDetail() {
  const { id } = useParams()
  const { can, lab } = useSession()
  const { open } = useActions()
  const people = usePeopleMap()
  const { data: locs = [] } = useLocations()
  const [act, setAct] = useState<BloodAction | null>(null)
  const { data: u, error, refetch } = useQuery({ queryKey: ['blood', 'unit', id], queryFn: () => q<BloodUnit>(supabase.from('blood_units').select('*').eq('id', id!).single()) })
  const { data: events } = useQuery({
    queryKey: ['blood', 'events', id],
    queryFn: () => q<{ id: string; from_status: string | null; to_status: string; note: string | null; performed_by: string | null; created_at: string }[]>(
      supabase.from('blood_unit_events').select('*').eq('unit_id', id!).order('created_at', { ascending: false })),
  })
  if (error) return <ErrorNote error={error} retry={refetch} />
  if (!u) return <SkeletonRows n={6} />

  const st = BLOOD_STATUS[u.status]
  const screens = SCREENS.map((s) => ({ ...s, v: u[s.key] }))
  const reactive = screens.some((s) => s.v === 'reactive')
  const allClear = screens.every((s) => s.v === 'non_reactive')
  const w = can('blood.write')
  const actions: { a: BloodAction; label: string; primary?: boolean; danger?: boolean; disabled?: boolean }[] = []
  if (w) {
    if (u.status === 'quarantine') { actions.push({ a: 'release', label: 'Release', primary: true, disabled: !allClear }, { a: 'screening', label: 'Update screening' }, { a: 'discard', label: 'Discard', danger: true }) }
    if (u.status === 'available') { actions.push({ a: 'issue', label: 'Issue', primary: true }, { a: 'reserve', label: 'Reserve' }, { a: 'screening', label: 'Screening' }, { a: 'discard', label: 'Discard', danger: true }) }
    if (u.status === 'reserved') { actions.push({ a: 'issue', label: 'Issue', primary: true }, { a: 'return', label: 'Cancel reservation' }, { a: 'discard', label: 'Discard', danger: true }) }
    if (u.status === 'issued') actions.push({ a: 'return', label: 'Return to stock' })
    if (u.status === 'expired') actions.push({ a: 'discard', label: 'Discard', danger: true, primary: true })
  }

  return (
    <>
      <Link to="/blood" className="crumb"><ChevronLeft size={14} /> Blood bank</Link>
      <header className="page-head" style={{ alignItems: 'stretch' }}>
        <div className="hstack" style={{ gap: 16, alignItems: 'flex-end' }}>
          <div style={{ fontFamily: 'var(--cond)', fontWeight: 600, fontSize: '4.2rem', lineHeight: 0.9, color: u.status === 'expired' || reactive ? 'var(--red)' : undefined }}>{groupLabel(u.abo, u.rh)}</div>
          <div>
            <div className="label">{COMPONENT_LABEL[u.component]}{u.volume_ml ? ` · ${u.volume_ml} mL` : ''}</div>
            <div className="hstack" style={{ marginTop: 4 }}><IdChip value={u.unit_number} /><Tag tone={st.tone} solid={u.status === 'expired'}>{st.label}</Tag></div>
          </div>
        </div>
        <div className="actions" style={{ alignItems: 'flex-end' }}>
          {!['issued', 'discarded'].includes(u.status) && <Expiry date={u.expiry_date} warnDays={lab?.blood_expiry_warning_days ?? 3} />}
        </div>
      </header>

      {reactive && (
        <div className="banner critical" role="alert"><Mark tone="critical" /><div className="b-body"><div className="b-title">Reactive screening result</div><p className="small">This unit must not be issued. Keep in quarantine and discard per SOP.</p></div></div>
      )}
      {u.status === 'reserved' && u.reserved_until && (
        <div className="banner warning"><Mark tone="warning" /><div className="b-body"><div className="b-title">Reserved · {u.request_ref}</div><p className="small">Returns to available automatically at {fmtDateTime(u.reserved_until)}.</p></div></div>
      )}

      {actions.length > 0 && (
        <div className="action-bar" style={{ marginBottom: 28 }}>
          {actions.map((x) => (
            <button key={x.a} className={`btn xl ${x.danger ? (x.primary ? 'danger' : '') : x.primary ? 'primary' : ''}`} disabled={x.disabled}
              title={x.disabled ? 'All four screens must be non-reactive' : undefined} onClick={() => setAct(x.a)}
              style={x.danger && !x.primary ? { color: 'var(--red)', borderColor: 'var(--red)' } : undefined}>{x.label}</button>
          ))}
        </div>
      )}

      <div className="grid-2">
        <div>
          <Section title="Screening">
            <div className="screening">
              {screens.map((s) => (
                <div key={s.key}>
                  <span className="label">{s.label}</span>
                  <span className="hstack"><Mark tone={s.v === 'reactive' ? 'critical' : s.v === 'non_reactive' ? 'ok' : 'neutral'} />
                    <b className={s.v === 'reactive' ? 'c-red' : ''}>{s.v === 'non_reactive' ? 'Non-reactive' : s.v === 'reactive' ? 'Reactive' : 'Pending'}</b></span>
                </div>
              ))}
            </div>
          </Section>
          <Section title="Status history">
            {!events ? <SkeletonRows n={3} /> : (
              <ul className="timeline" style={{ marginTop: 16 }}>
                {events.map((e) => (
                  <li key={e.id} className={e.to_status === 'expired' || e.to_status === 'discarded' ? 'critical' : e.to_status === 'available' ? 'ok' : ''}>
                    <div><b>{BLOOD_STATUS[e.to_status as keyof typeof BLOOD_STATUS]?.label ?? e.to_status}</b>{e.note ? <span className="muted"> · {e.note}</span> : null}</div>
                    <div className="small faint mono">{fmtDateTime(e.created_at)} · {people.get(e.performed_by ?? '')?.full_name ?? 'System'}</div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
        <div>
          <Section title="Details">
            <dl className="spec">
              <dt>Collected</dt><dd>{fmtDate(u.collection_date)}</dd>
              <dt>Expires</dt><dd>{fmtDate(u.expiry_date)}</dd>
              <dt>Donor code</dt><dd><IdChip value={u.donor_code} /></dd>
              <dt>Storage</dt><dd>{locs.find((l) => l.id === u.location_id)?.name ?? '—'}</dd>
              {u.request_ref && <><dt>Request ref</dt><dd className="mono">{u.request_ref}</dd></>}
              {u.issued_to && <><dt>Issued to</dt><dd>{u.issued_to} · {fmtDateTime(u.issued_at)}</dd></>}
              {u.discard_reason && <><dt>Discard reason</dt><dd>{u.discard_reason}</dd></>}
              <dt>Added</dt><dd>{fmtDateTime(u.created_at)}</dd>
            </dl>
          </Section>
          <button className="btn sm" onClick={() => open({ kind: 'task', preset: { linked_blood_unit_id: u.id, title: `Follow up unit ${u.unit_number}` } })}>+ Linked task</button>
        </div>
      </div>
      {act && <BloodActionSheet unit={u} action={act} onClose={() => setAct(null)} />}
    </>
  )
}
