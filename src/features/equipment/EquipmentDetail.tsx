import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'
import { supabase, q, friendlyError } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { useActions } from '../../lib/actions'
import { useToast } from '../../lib/toast'
import { useLocations, usePeopleMap } from '../../lib/data'
import type { Equipment, EquipStatus } from '../../lib/types'
import { EquipmentSheet, MaintenanceSheet } from './sheets'
import { Empty, ErrorNote, Expiry, IdChip, Mark, PageHead, Section, SkeletonRows, Tag } from '../../components/ui'
import { EQUIP_STATUS, fmtDate, fmtDateTime, fmtShort, num } from '../../lib/format'

interface Reading { id: string; reading_c: number; recorded_at: string; out_of_range: boolean; action_taken: string | null; recorded_by: string | null }

/** 14-day temperature chart with the safe band shaded. Hand-drawn SVG, no chart library. */
function TempChart({ readings, min, max }: { readings: Reading[]; min: number | null; max: number | null }) {
  const W = 640, H = 200, P = { l: 34, r: 10, t: 10, b: 22 }
  const end = Date.now(), start = end - 14 * 86400000
  const pts = readings.filter((r) => new Date(r.recorded_at).getTime() >= start).sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
  const vals = [...pts.map((p) => p.reading_c), min ?? 0, max ?? 0]
  let lo = Math.min(...vals), hi = Math.max(...vals)
  const pad = Math.max(1, (hi - lo) * 0.15); lo -= pad; hi += pad
  const x = (t: number) => P.l + ((t - start) / (end - start)) * (W - P.l - P.r)
  const y = (v: number) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b)
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4)
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(new Date(p.recorded_at).getTime()).toFixed(1)},${y(p.reading_c).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`Temperature readings, last 14 days. ${pts.length} readings.`}>
      {min != null && max != null && <rect x={P.l} width={W - P.l - P.r} y={y(max)} height={Math.max(0, y(min) - y(max))} fill="var(--green-wash)" />}
      {ticks.map((t, i) => <g key={i}><line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--rule)" strokeWidth="1" /><text x={P.l - 6} y={y(t) + 3} textAnchor="end">{t.toFixed(1)}</text></g>)}
      {min != null && <line x1={P.l} x2={W - P.r} y1={y(min)} y2={y(min)} stroke="var(--green)" strokeDasharray="4 3" />}
      {max != null && <line x1={P.l} x2={W - P.r} y1={y(max)} y2={y(max)} stroke="var(--green)" strokeDasharray="4 3" />}
      {[0, 7, 14].map((d) => { const t = start + d * 86400000; return <text key={d} x={x(t)} y={H - 6} textAnchor={d === 0 ? 'start' : d === 14 ? 'end' : 'middle'}>{fmtShort(new Date(t))}</text> })}
      <path d={path} fill="none" stroke="var(--ink)" strokeWidth="1.5" />
      {pts.map((p) => p.out_of_range
        ? <rect key={p.id} x={x(new Date(p.recorded_at).getTime()) - 4} y={y(p.reading_c) - 4} width="8" height="8" fill="var(--red)" />
        : <circle key={p.id} cx={x(new Date(p.recorded_at).getTime())} cy={y(p.reading_c)} r="2.5" fill="var(--ink)" />)}
    </svg>
  )
}

export default function EquipmentDetail() {
  const { id } = useParams()
  const { can, profile } = useSession()
  const { open } = useActions()
  const toast = useToast()
  const qc = useQueryClient()
  const people = usePeopleMap()
  const { data: locs = [] } = useLocations()
  const [edit, setEdit] = useState(false)
  const [maint, setMaint] = useState(false)
  const { data: e, error, refetch } = useQuery({ queryKey: ['equipment', 'one', id], queryFn: () => q<Equipment>(supabase.from('equipment').select('*').eq('id', id!).single()) })
  const { data: logs } = useQuery({
    queryKey: ['equipment', 'maint', id],
    queryFn: () => q<{ id: string; kind: string; performed_on: string; technician_id: string | null; external_vendor: string | null; description: string | null; downtime_hours: number | null; next_due_date: string | null }[]>(
      supabase.from('maintenance_logs').select('*').eq('equipment_id', id!).order('performed_on', { ascending: false }).limit(50)),
  })
  const { data: readings } = useQuery({
    queryKey: ['equipment', 'temps', id], enabled: !!e?.is_cold_storage,
    queryFn: () => q<Reading[]>(supabase.from('temperature_logs').select('*').eq('equipment_id', id!).gte('recorded_at', new Date(Date.now() - 14 * 86400000).toISOString()).order('recorded_at', { ascending: false })),
  })
  if (error) return <ErrorNote error={error} retry={refetch} />
  if (!e) return <SkeletonRows n={6} />
  const st = EQUIP_STATUS[e.status]
  const canLog = can('equipment.write') || e.assigned_technician_id === profile?.id
  const setStatus = async (s: EquipStatus) => {
    try { await q(supabase.from('equipment').update({ status: s }).eq('id', e.id)); qc.invalidateQueries({ queryKey: ['equipment'] }); toast(`Status: ${EQUIP_STATUS[s].label}`) }
    catch (err) { toast(friendlyError(err), { tone: 'error' }) }
  }
  const oor = readings?.filter((r) => r.out_of_range).length ?? 0
  const KIND: Record<string, string> = { service: 'Service', calibration: 'Calibration', repair: 'Repair', inspection: 'Inspection' }

  return (
    <>
      <PageHead crumb={<Link to="/equipment" className="crumb"><ChevronLeft size={14} /> Equipment</Link>}
        kicker={[e.category, e.asset_tag].filter(Boolean).join(' · ') || 'Equipment'} title={e.name}
        actions={<>
          {e.is_cold_storage && <button className="btn primary" onClick={() => open({ kind: 'temp', equipmentId: e.id })}>Log reading</button>}
          {canLog && <button className="btn" onClick={() => setMaint(true)}>Log maintenance</button>}
          {can('equipment.write') && <button className="btn ghost" onClick={() => setEdit(true)}>Edit</button>}
        </>} />

      <div className="hstack" style={{ marginBottom: 20 }}>
        <Mark tone={st.tone} /><b>{st.label}</b>
        {can('equipment.write') && (
          <select className="select" style={{ width: 'auto', minHeight: 34, padding: '4px 30px 4px 8px', fontSize: '0.85rem' }} value={e.status} onChange={(ev) => setStatus(ev.target.value as EquipStatus)} aria-label="Change status">
            {Object.entries(EQUIP_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        )}
      </div>

      {e.is_cold_storage && (
        <Section title={`Temperature · last 14 days · ${e.temp_min_c} to ${e.temp_max_c} °C`} action={oor ? <span className="tag critical">{oor} out of range</span> : undefined}>
          {!readings ? <SkeletonRows n={2} /> : readings.length === 0 ? <Empty text="No readings yet." action={<button className="btn primary sm" onClick={() => open({ kind: 'temp', equipmentId: e.id })}>Log first reading</button>} /> : (
            <>
              <div style={{ padding: '12px 0' }}><TempChart readings={readings} min={e.temp_min_c} max={e.temp_max_c} /></div>
              <ul className="ledger">
                {readings.slice(0, 8).map((r) => (
                  <li key={r.id} className="row">
                    <Mark tone={r.out_of_range ? 'critical' : 'ok'} title={r.out_of_range ? 'Out of range' : 'In range'} />
                    <span style={{ minWidth: 0 }}>
                      <span className="main-line mono" style={{ display: 'block' }}>{fmtDateTime(r.recorded_at)}</span>
                      <span className="sub-line" style={{ display: 'block' }}>{people.get(r.recorded_by ?? '')?.full_name ?? '—'}{r.action_taken ? ` · ${r.action_taken}` : ''}</span>
                    </span>
                    <span className={`end mono ${r.out_of_range ? 'c-red' : ''}`} style={{ fontSize: '1.1rem' }}>{num(r.reading_c)} °C</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      )}

      <div className="grid-2">
        <Section title="Maintenance log">
          {!logs ? <SkeletonRows n={3} /> : logs.length === 0 ? <Empty text="No maintenance recorded yet." /> : (
            <ul className="timeline" style={{ marginTop: 16 }}>
              {logs.map((l) => (
                <li key={l.id} className={l.kind === 'repair' ? 'critical' : 'ok'}>
                  <div><b>{KIND[l.kind]}</b> <span className="muted">· {fmtDate(l.performed_on)}</span></div>
                  <div className="small">{l.description ?? ''}</div>
                  <div className="small faint">{[l.technician_id ? people.get(l.technician_id)?.full_name : null, l.external_vendor, l.downtime_hours ? `${l.downtime_hours}h downtime` : null, l.next_due_date ? `next due ${fmtDate(l.next_due_date)}` : null].filter(Boolean).join(' · ')}</div>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Details">
          <dl className="spec">
            <dt>Asset tag</dt><dd><IdChip value={e.asset_tag} /></dd>
            <dt>Location</dt><dd>{locs.find((l) => l.id === e.location_id)?.name ?? '—'}</dd>
            <dt>Technician</dt><dd>{people.get(e.assigned_technician_id ?? '')?.full_name ?? '—'}</dd>
            <dt>Next service</dt><dd className="hstack">{fmtDate(e.next_service_date)} {e.next_service_date && <Expiry date={e.next_service_date} warnDays={7} />}</dd>
            <dt>Service every</dt><dd>{e.service_interval_days ? `${e.service_interval_days} days` : '—'}</dd>
            <dt>Next calibration</dt><dd className="hstack">{fmtDate(e.next_calibration_date)} {e.next_calibration_date && <Expiry date={e.next_calibration_date} warnDays={7} />}</dd>
            <dt>Calibrate every</dt><dd>{e.calibration_interval_days ? `${e.calibration_interval_days} days` : '—'}</dd>
            <dt>Make / model</dt><dd>{[e.manufacturer, e.model].filter(Boolean).join(' ') || '—'}</dd>
            <dt>Serial no.</dt><dd><IdChip value={e.serial_number} /></dd>
            {e.notes && <><dt>Notes</dt><dd>{e.notes}</dd></>}
          </dl>
          <div style={{ marginTop: 12 }}><Tag>{e.is_cold_storage ? `Cold storage · ${e.readings_per_day} checks/day` : 'Not cold storage'}</Tag></div>
        </Section>
      </div>
      {edit && <EquipmentSheet equipment={e} onClose={() => setEdit(false)} />}
      {maint && <MaintenanceSheet equipment={e} onClose={() => setMaint(false)} />}
    </>
  )
}
