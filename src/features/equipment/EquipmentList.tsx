import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { supabase, q } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { useActions } from '../../lib/actions'
import { useLocations } from '../../lib/data'
import type { Equipment } from '../../lib/types'
import { Empty, ErrorNote, Expiry, Mark, PageHead, Section, SkeletonRows, Tag, IdChip } from '../../components/ui'
import { EquipmentSheet, useColdStatus } from './sheets'
import { EQUIP_STATUS, num, relTime } from '../../lib/format'

export function useEquipment() {
  return useQuery({ queryKey: ['equipment', 'list'], queryFn: () => q<Equipment[]>(supabase.from('equipment').select('*').order('name')) })
}

export default function EquipmentList() {
  const { can } = useSession()
  const { open } = useActions()
  const nav = useNavigate()
  const { data: cold } = useColdStatus()
  const { data, isLoading, error, refetch } = useEquipment()
  const { data: locs = [] } = useLocations()
  const [add, setAdd] = useState(false)
  const [showRetired, setShowRetired] = useState(false)
  const list = (data ?? []).filter((e) => showRetired || e.status !== 'retired')

  return (
    <>
      <PageHead kicker="04 · Equipment" title="Equipment & cold chain" actions={<>
        <button className="btn primary" onClick={() => open({ kind: 'temp' })}>Temperature round</button>
        {can('equipment.write') && <button className="btn" onClick={() => setAdd(true)}><Plus size={16} /> Equipment</button>}
      </>} />

      <Section title="Cold storage · latest readings" count={cold?.length}>
        {!cold ? <SkeletonRows n={3} /> : cold.length === 0 ? <Empty text='No fridges or freezers yet. Add equipment and tick "Cold storage".' /> : (
          <ul className="ledger">
            {cold.map((c) => (
              <li key={c.id} className="row">
                <Mark tone={c.last_out_of_range ? 'critical' : c.reading_due ? 'warning' : 'ok'} title={c.last_out_of_range ? 'Out of range' : c.reading_due ? 'Reading due' : 'In range'} />
                <Link to={`/equipment/${c.id}`} style={{ minWidth: 0, textDecoration: 'none' }}>
                  <span className="main-line" style={{ display: 'block' }}>{c.name}</span>
                  <span className="sub-line" style={{ display: 'block' }}>{c.temp_min_c} to {c.temp_max_c} °C · {c.readings_per_day}× daily · {c.last_recorded_at ? relTime(c.last_recorded_at) : 'never logged'}</span>
                </Link>
                <span className="end">
                  <span className={`mono ${c.last_out_of_range ? 'c-red' : ''}`} style={{ fontSize: '1.3rem' }}>{c.last_reading_c != null ? `${num(c.last_reading_c)}°` : '—'}</span>
                  <button className={`btn sm ${c.reading_due ? 'primary' : ''}`} onClick={() => open({ kind: 'temp', equipmentId: c.id })}>Log</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="All equipment" count={list.length} action={<label className="small hstack" style={{ cursor: 'pointer' }}><input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} /> Show retired</label>}>
        {error ? <ErrorNote error={error} retry={refetch} /> : isLoading ? <SkeletonRows n={5} /> : list.length === 0 ? (
          <Empty text="No equipment registered yet." action={can('equipment.write') && <button className="btn primary sm" onClick={() => setAdd(true)}>Add equipment</button>} />
        ) : (
          <>
            <ul className="ledger only-mobile">
              {list.map((e) => {
                const st = EQUIP_STATUS[e.status]
                return (
                  <li key={e.id}><Link to={`/equipment/${e.id}`} className="row">
                    <Mark tone={st.tone} title={st.label} />
                    <span style={{ minWidth: 0 }}>
                      <span className="main-line" style={{ display: 'block' }}>{e.name}</span>
                      <span className="sub-line" style={{ display: 'block' }}>{st.label}{e.asset_tag ? ` · ${e.asset_tag}` : ''}</span>
                    </span>
                    <span className="end" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      {e.next_service_date && <span className="small hstack" style={{ gap: 4 }}><span className="faint">Svc</span><Expiry date={e.next_service_date} warnDays={7} /></span>}
                      {e.next_calibration_date && <span className="small hstack" style={{ gap: 4 }}><span className="faint">Cal</span><Expiry date={e.next_calibration_date} warnDays={7} /></span>}
                    </span>
                  </Link></li>
                )
              })}
            </ul>
            <div className="table-wrap only-desktop">
              <table className="table">
                <thead><tr><th style={{ width: 28 }} /><th>Name</th><th>Asset tag</th><th>Location</th><th>Status</th><th>Next service</th><th>Next calibration</th></tr></thead>
                <tbody>{list.map((e) => (
                  <tr key={e.id} onClick={() => nav(`/equipment/${e.id}`)}>
                    <td><Mark tone={EQUIP_STATUS[e.status].tone} /></td>
                    <td style={{ fontWeight: 500 }}>{e.name}{e.is_cold_storage && <span className="faint small"> · cold</span>}</td>
                    <td><IdChip value={e.asset_tag} /></td>
                    <td className="muted">{locs.find((l) => l.id === e.location_id)?.name ?? '—'}</td>
                    <td><Tag tone={EQUIP_STATUS[e.status].tone}>{EQUIP_STATUS[e.status].label}</Tag></td>
                    <td>{e.next_service_date ? <Expiry date={e.next_service_date} warnDays={7} /> : <span className="faint">—</span>}</td>
                    <td>{e.next_calibration_date ? <Expiry date={e.next_calibration_date} warnDays={7} /> : <span className="faint">—</span>}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          </>
        )}
      </Section>
      {add && <EquipmentSheet onClose={() => setAdd(false)} onSaved={(id) => nav(`/equipment/${id}`)} />}
    </>
  )
}
