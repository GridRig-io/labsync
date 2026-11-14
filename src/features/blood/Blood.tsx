import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, Plus } from 'lucide-react'
import { supabase, q } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { useActions } from '../../lib/actions'
import { useLocations } from '../../lib/data'
import type { BloodStatus, BloodUnit, Component } from '../../lib/types'
import { Chips, Empty, ErrorNote, Expiry, Mark, PageHead, Section, SkeletonRows, Tag, IdChip } from '../../components/ui'
import { useBloodSummary, BloodStrip } from '../today/Today'
import {
  BLOOD_STATUS, COMPONENTS, COMPONENT_LABEL, COMPONENT_SHORT, daysUntil, GROUPS, groupLabel, addDaysISO, todayISO,
} from '../../lib/format'

export default function Blood() {
  const { can, lab } = useSession()
  const { open } = useActions()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const { data: summary } = useBloodSummary()
  const { data: locs = [] } = useLocations()
  const [comp, setComp] = useState<Component>((params.get('component') as Component) || 'packed_red_cells')
  const [s, setS] = useState('')
  const status = (params.get('status') as BloodStatus | 'active' | 'all') || 'active'
  const group = params.get('group') ?? ''
  const component = params.get('component') ?? ''
  const expiring = params.get('expiring') === '1'
  const bWarn = lab?.blood_expiry_warning_days ?? 3

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v); else p.delete(k)
    setParams(p, { replace: true })
  }

  const { data: units, isLoading, error, refetch } = useQuery({
    queryKey: ['blood', 'units', status, group, component, expiring],
    queryFn: () => {
      let qy = supabase.from('blood_units').select('*')
      if (status === 'active') qy = qy.in('status', ['quarantine', 'available', 'reserved'])
      else if (status !== 'all') qy = qy.eq('status', status)
      if (group) { qy = qy.eq('abo', group.replace(/(pos|neg)$/, '')).eq('rh', group.endsWith('pos') ? 'pos' : 'neg') }
      if (component) qy = qy.eq('component', component)
      if (expiring) qy = qy.lte('expiry_date', addDaysISO(todayISO(), bWarn))
      return q<BloodUnit[]>(qy.order('expiry_date', { ascending: true }).limit(300))
    },
  })
  const list = useMemo(() => {
    const t = s.trim().toLowerCase()
    return (units ?? []).filter((u) => !t || u.unit_number.toLowerCase().includes(t) || u.donor_code?.toLowerCase().includes(t))
  }, [units, s])
  const low = summary?.filter((x) => x.below_minimum) ?? []

  return (
    <>
      <PageHead kicker="03 · Blood bank" title="Blood bank" actions={can('blood.write') && <button className="btn primary" onClick={() => open({ kind: 'blood-add' })}><Plus size={16} /> Add unit</button>} />

      {low.length > 0 && (
        <div className="banner critical" role="alert">
          <Mark tone="critical" />
          <div className="b-body">
            <div className="b-title">{low.length} {low.length === 1 ? 'line is' : 'lines are'} below minimum stock</div>
            <p className="small">{low.slice(0, 8).map((x) => `${groupLabel(x.abo, x.rh)} ${COMPONENT_SHORT[x.component]} (${x.available_units}/${x.min_units})`).join(' · ')}{low.length > 8 ? ` · +${low.length - 8} more` : ''}</p>
          </div>
        </div>
      )}

      <Section title="Available stock">
        <div className="only-mobile">
          <div style={{ padding: '10px 0' }}><Chips value={comp} onChange={setComp} options={COMPONENTS.map((c) => ({ value: c, label: COMPONENT_SHORT[c] }))} /></div>
          {summary ? <BloodStrip summary={summary} component={comp} /> : <SkeletonRows n={2} />}
        </div>
        <div className="only-desktop" style={{ overflowX: 'auto' }}>
          {summary ? (
            <table className="matrix">
              <thead><tr><th /> {COMPONENTS.map((c) => <th key={c}>{COMPONENT_LABEL[c]}</th>)}</tr></thead>
              <tbody>
                {GROUPS.map((g) => (
                  <tr key={groupLabel(g.abo, g.rh)}>
                    <th scope="row">{groupLabel(g.abo, g.rh)}</th>
                    {COMPONENTS.map((c) => {
                      const x = summary.find((y) => y.abo === g.abo && y.rh === g.rh && y.component === c)
                      const n = x?.available_units ?? 0
                      return (
                        <td key={c} className={x?.below_minimum ? 'low' : n === 0 ? 'zero' : ''}>
                          <Link to={`/blood?group=${g.abo}${g.rh}&component=${c}&status=available`} aria-label={`${groupLabel(g.abo, g.rh)} ${COMPONENT_LABEL[c]}: ${n} of minimum ${x?.min_units ?? 0}`}>
                            {x?.below_minimum && <span aria-hidden>■ </span>}{n}<span className="of"> / {x?.min_units ?? 0}</span>
                            {(x?.quarantine_units ?? 0) > 0 && <span className="of c-blue"> · {x!.quarantine_units}Q</span>}
                          </Link>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <SkeletonRows n={4} />}
          <p className="small faint" style={{ marginTop: 6 }}>Available / minimum. Q = in quarantine. ■ = below minimum.</p>
        </div>
      </Section>

      <Section title="Units" count={list.length}>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <div className="search"><Search size={18} /><input className="input mono" placeholder="Unit number or donor code" value={s} onChange={(e) => setS(e.target.value)} aria-label="Search units" /></div>
          <select className="select" style={{ width: 'auto' }} value={group} onChange={(e) => setParam('group', e.target.value)} aria-label="Group">
            <option value="">All groups</option>{GROUPS.map((g) => <option key={g.abo + g.rh} value={g.abo + g.rh}>{groupLabel(g.abo, g.rh)}</option>)}
          </select>
          <select className="select" style={{ width: 'auto' }} value={component} onChange={(e) => setParam('component', e.target.value)} aria-label="Component">
            <option value="">All components</option>{COMPONENTS.map((c) => <option key={c} value={c}>{COMPONENT_LABEL[c]}</option>)}
          </select>
        </div>
        <div className="hstack" style={{ marginBottom: 12, flexWrap: 'nowrap' }}>
          <Chips value={status} onChange={(v) => setParam('status', v === 'active' ? '' : v)} options={[
            { value: 'active', label: 'In stock' }, { value: 'available', label: 'Available' }, { value: 'quarantine', label: 'Quarantine' },
            { value: 'reserved', label: 'Reserved' }, { value: 'issued', label: 'Issued' }, { value: 'expired', label: 'Expired' }, { value: 'discarded', label: 'Discarded' }, { value: 'all', label: 'All' }]} />
        </div>
        <label className="hstack small" style={{ marginBottom: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={expiring} onChange={(e) => setParam('expiring', e.target.checked ? '1' : '')} /> Expiring within {bWarn} days
        </label>

        {error ? <ErrorNote error={error} retry={refetch} /> : isLoading ? <SkeletonRows n={6} /> : list.length === 0 ? (
          <Empty text={units?.length === 0 && status === 'active' && !group && !component ? 'No blood units in stock yet.' : 'No units match these filters.'}
            action={can('blood.write') && <button className="btn primary sm" onClick={() => open({ kind: 'blood-add' })}>Add a unit</button>} />
        ) : (
          <>
            <ul className="ledger only-mobile">
              {list.map((u) => <UnitRow key={u.id} u={u} warn={bWarn} />)}
            </ul>
            <div className="table-wrap only-desktop">
              <table className="table">
                <thead><tr><th style={{ width: 28 }} /><th>Unit no.</th><th>Group</th><th>Component</th><th>Status</th><th>Expiry</th><th>Location</th><th>Reference</th></tr></thead>
                <tbody>
                  {list.map((u) => (
                    <tr key={u.id} onClick={() => nav(`/blood/${u.id}`)}>
                      <td><Mark tone={BLOOD_STATUS[u.status].tone} title={BLOOD_STATUS[u.status].label} /></td>
                      <td><IdChip value={u.unit_number} /></td>
                      <td className="title-m" style={{ fontSize: '1.05rem' }}>{groupLabel(u.abo, u.rh)}</td>
                      <td>{COMPONENT_LABEL[u.component]}</td>
                      <td><Tag tone={BLOOD_STATUS[u.status].tone}>{BLOOD_STATUS[u.status].label}</Tag></td>
                      <td>{['issued', 'discarded'].includes(u.status) ? <span className="faint">—</span> : <Expiry date={u.expiry_date} warnDays={bWarn} />}</td>
                      <td className="muted">{locs.find((l) => l.id === u.location_id)?.name ?? '—'}</td>
                      <td className="mono small">{u.request_ref ?? ''}{u.issued_to ? ` · ${u.issued_to}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>
    </>
  )
}

function UnitRow({ u, warn }: { u: BloodUnit; warn: number }) {
  const st = BLOOD_STATUS[u.status]
  const d = daysUntil(u.expiry_date)
  return (
    <li>
      <Link to={`/blood/${u.id}`} className="row" style={{ gridTemplateColumns: '20px 52px minmax(0,1fr) auto' }}>
        <Mark tone={st.tone} title={st.label} />
        <span className="title-m" style={{ fontSize: '1.3rem' }}>{groupLabel(u.abo, u.rh)}</span>
        <span style={{ minWidth: 0 }}>
          <span className="main-line mono" style={{ display: 'block' }}>{u.unit_number}</span>
          <span className="sub-line" style={{ display: 'block' }}>{COMPONENT_SHORT[u.component]} · {st.label}{u.request_ref ? ` · ${u.request_ref}` : ''}</span>
        </span>
        <span className="end">{['issued', 'discarded'].includes(u.status) ? null : d != null && <Expiry date={u.expiry_date} warnDays={warn} />}</span>
      </Link>
    </li>
  )
}
