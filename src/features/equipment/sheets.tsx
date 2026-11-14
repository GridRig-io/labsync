import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, q, friendlyError } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { useLocations, usePeople } from '../../lib/data'
import type { ColdStatus, Equipment } from '../../lib/types'
import { Field, Mark, Sheet, Seg, Chips } from '../../components/ui'
import { relTime, todayISO, num } from '../../lib/format'

export function useColdStatus() {
  return useQuery({
    queryKey: ['equipment', 'cold'],
    queryFn: () => q<ColdStatus[]>(supabase.from('cold_storage_status').select('*').order('name')),
    refetchInterval: 5 * 60 * 1000,
  })
}

const rangeText = (c: { temp_min_c: number | null; temp_max_c: number | null }) =>
  `${c.temp_min_c ?? '–'} to ${c.temp_max_c ?? '–'} °C`

/* ---------- log a temperature reading ---------- */
export function TempSheet({ equipmentId: initial, onClose }: { equipmentId?: string; onClose: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const { data: units = [], isLoading } = useColdStatus()
  const [id, setId] = useState(initial)
  const unit = units.find((u) => u.id === id)
  const [val, setVal] = useState('')
  const [action, setAction] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (unit && val === '') setVal(unit.last_reading_c != null ? String(unit.last_reading_c) : unit.temp_min_c != null && unit.temp_max_c != null ? String((unit.temp_min_c + unit.temp_max_c) / 2) : '')
  }, [unit, val])

  const reading = parseFloat(val.replace(',', '.'))
  const valid = Number.isFinite(reading)
  const out = valid && unit && ((unit.temp_min_c != null && reading < unit.temp_min_c) || (unit.temp_max_c != null && reading > unit.temp_max_c))
  const bump = (d: number) => setVal(String(+((valid ? reading : 0) + d).toFixed(1)))

  const save = async () => {
    if (!unit || !valid) return
    if (out && !action.trim()) { toast('Out of range: record the action taken', { tone: 'error' }); return }
    setBusy(true)
    try {
      await q(supabase.from('temperature_logs').insert({ equipment_id: unit.id, reading_c: reading, action_taken: action || null }))
      qc.invalidateQueries({ queryKey: ['equipment'] }); qc.invalidateQueries({ queryKey: ['today'] })
      toast(out ? `${unit.name}: ${reading} °C logged · supervisors alerted` : `${unit.name}: ${reading} °C logged`, out ? { tone: 'error' } : undefined)
      // move straight on to the next unit that is due, to make rounds quick
      const next = units.find((u) => u.id !== unit.id && u.reading_due)
      if (!initial && next) { setId(next.id); setVal(''); setAction('') } else onClose()
    } catch (e) { toast(friendlyError(e), { tone: 'error' }) } finally { setBusy(false) }
  }

  return (
    <Sheet open onClose={onClose} title={unit ? `Temperature · ${unit.name}` : 'Log temperature'}
      footer={unit ? <>
        <button className="btn" onClick={() => (initial ? onClose() : (setId(undefined), setVal('')))}>{initial ? 'Cancel' : 'Back'}</button>
        <button className={`btn xl ${out ? 'danger' : 'primary'}`} disabled={busy || !valid} onClick={save}>{busy ? 'Saving…' : `Log ${valid ? reading : ''} °C`}</button>
      </> : undefined}>
      {!unit ? (
        <>
          {isLoading && <p className="muted">Loading…</p>}
          {!isLoading && units.length === 0 && <p className="muted">No fridges or freezers yet. Add one in Equipment and tick "Cold storage".</p>}
          <ul className="ledger">
            {units.map((u) => (
              <li key={u.id}>
                <button className="row" onClick={() => setId(u.id)}>
                  <Mark tone={u.last_out_of_range ? 'critical' : u.reading_due ? 'warning' : 'ok'} title={u.last_out_of_range ? 'Out of range' : u.reading_due ? 'Reading due' : 'In range'} />
                  <span style={{ minWidth: 0 }}>
                    <span className="main-line" style={{ display: 'block' }}>{u.name}</span>
                    <span className="sub-line" style={{ display: 'block' }}>{rangeText(u)} · {u.last_recorded_at ? `last ${relTime(u.last_recorded_at)}` : 'no readings yet'}</span>
                  </span>
                  <span className="end">
                    {u.reading_due && <span className="tag warning">Due</span>}
                    <span className={`mono ${u.last_out_of_range ? 'c-red' : ''}`}>{u.last_reading_c != null ? `${num(u.last_reading_c)}°` : '—'}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className="label" style={{ marginBottom: 8 }}>Allowed range {rangeText(unit)}</p>
          <div className="stepper" style={{ gridTemplateColumns: '64px 1fr 64px', marginBottom: 8 }}>
            <button type="button" onClick={() => bump(-0.5)} aria-label="Down 0.5">−</button>
            <input aria-label="Reading in °C" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} onFocus={(e) => e.target.select()}
              style={{ color: out ? 'var(--red)' : undefined, fontSize: '2.4rem' }} />
            <button type="button" onClick={() => bump(0.5)} aria-label="Up 0.5">+</button>
          </div>
          <div className="hstack" style={{ marginBottom: 16 }}>
            <button className="btn sm" type="button" onClick={() => setVal(valid ? String(-reading) : '-')}>± Sign</button>
            <button className="btn sm" type="button" onClick={() => bump(-0.1)}>−0.1</button>
            <button className="btn sm" type="button" onClick={() => bump(0.1)}>+0.1</button>
          </div>
          {out && (
            <div className="banner critical" role="alert">
              <div className="b-body"><div className="b-title">Out of range</div>
                <p className="small">Supervisors will be alerted. Record what you did.</p></div>
            </div>
          )}
          {out && (
            <Field label="Action taken *">
              <Chips value={action} onChange={setAction} options={[
                { value: 'Door was open, closed and re-checked', label: 'Door closed' },
                { value: 'Moved contents to backup unit', label: 'Moved contents' },
                { value: 'Reported to supervisor', label: 'Reported' },
                { value: 'Re-checked thermometer', label: 'Re-checked' },
              ]} />
              <textarea className="textarea" value={action} onChange={(e) => setAction(e.target.value)} placeholder="Or type what you did" style={{ marginTop: 8 }} />
            </Field>
          )}
        </>
      )}
    </Sheet>
  )
}

/* ---------- log maintenance ---------- */
export function MaintenanceSheet({ equipment, onClose }: { equipment: Equipment; onClose: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const { data: people = [] } = usePeople()
  const [f, setF] = useState({ kind: 'service', performed_on: todayISO(), technician_id: '', external_vendor: '', description: '', cost: '', downtime_hours: '', next_due_date: '' })
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await q(supabase.from('maintenance_logs').insert({
        equipment_id: equipment.id, kind: f.kind, performed_on: f.performed_on,
        technician_id: f.technician_id || undefined, external_vendor: f.external_vendor || null, description: f.description || null,
        cost: f.cost ? Number(f.cost) : null, downtime_hours: f.downtime_hours ? Number(f.downtime_hours) : null, next_due_date: f.next_due_date || null,
      }))
      qc.invalidateQueries({ queryKey: ['equipment'] })
      toast('Maintenance logged'); onClose()
    } catch (e) { toast(friendlyError(e), { tone: 'error' }) } finally { setBusy(false) }
  }
  const interval = f.kind === 'service' ? equipment.service_interval_days : f.kind === 'calibration' ? equipment.calibration_interval_days : null
  return (
    <Sheet open onClose={onClose} title={`Log maintenance · ${equipment.name}`}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <Field label="Type"><Seg full value={f.kind} onChange={(kind) => setF({ ...f, kind })} options={[
        { value: 'service', label: 'Service' }, { value: 'calibration', label: 'Calibrate' }, { value: 'repair', label: 'Repair' }, { value: 'inspection', label: 'Inspect' }]} /></Field>
      <div className="row-fields">
        <Field label="Done on" htmlFor="m-on"><input id="m-on" type="date" className="input" value={f.performed_on} onChange={(e) => setF({ ...f, performed_on: e.target.value })} /></Field>
        <Field label="Next due" htmlFor="m-next" hint={interval ? `Auto: +${interval} days if empty` : undefined}><input id="m-next" type="date" className="input" value={f.next_due_date} onChange={(e) => setF({ ...f, next_due_date: e.target.value })} /></Field>
      </div>
      <Field label="Technician" htmlFor="m-tech"><select id="m-tech" className="select" value={f.technician_id} onChange={(e) => setF({ ...f, technician_id: e.target.value })}><option value="">Me</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></Field>
      <Field label="External vendor" htmlFor="m-ven"><input id="m-ven" className="input" value={f.external_vendor} onChange={(e) => setF({ ...f, external_vendor: e.target.value })} /></Field>
      <Field label="What was done" htmlFor="m-desc"><textarea id="m-desc" className="textarea" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="row-fields">
        <Field label="Downtime (hours)" htmlFor="m-dt"><input id="m-dt" className="input mono" inputMode="decimal" value={f.downtime_hours} onChange={(e) => setF({ ...f, downtime_hours: e.target.value })} /></Field>
        <Field label="Cost (₦)" htmlFor="m-cost"><input id="m-cost" className="input mono" inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></Field>
      </div>
    </Sheet>
  )
}

/* ---------- create / edit equipment ---------- */
export function EquipmentSheet({ equipment, onClose, onSaved }: { equipment?: Equipment; onClose: () => void; onSaved?: (id: string) => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const { data: locations = [] } = useLocations()
  const { data: people = [] } = usePeople()
  const e0 = equipment
  const [f, setF] = useState({
    name: e0?.name ?? '', asset_tag: e0?.asset_tag ?? '', category: e0?.category ?? '', manufacturer: e0?.manufacturer ?? '', model: e0?.model ?? '',
    serial_number: e0?.serial_number ?? '', location_id: e0?.location_id ?? '', status: e0?.status ?? 'operational',
    service_interval_days: e0?.service_interval_days?.toString() ?? '', calibration_interval_days: e0?.calibration_interval_days?.toString() ?? '',
    next_service_date: e0?.next_service_date ?? '', next_calibration_date: e0?.next_calibration_date ?? '',
    assigned_technician_id: e0?.assigned_technician_id ?? '', is_cold_storage: e0?.is_cold_storage ?? false,
    temp_min_c: e0?.temp_min_c?.toString() ?? '', temp_max_c: e0?.temp_max_c?.toString() ?? '', readings_per_day: e0?.readings_per_day?.toString() ?? '2', notes: e0?.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const n = (v: string) => (v === '' ? null : Number(v))
  const s = (v: string) => (v.trim() === '' ? null : v.trim())
  const save = async () => {
    if (!f.name.trim()) { toast('Give it a name', { tone: 'error' }); return }
    setBusy(true)
    const row = {
      name: f.name.trim(), asset_tag: s(f.asset_tag), category: s(f.category), manufacturer: s(f.manufacturer), model: s(f.model),
      serial_number: s(f.serial_number), location_id: s(f.location_id), status: f.status,
      service_interval_days: n(f.service_interval_days), calibration_interval_days: n(f.calibration_interval_days),
      next_service_date: s(f.next_service_date), next_calibration_date: s(f.next_calibration_date),
      assigned_technician_id: s(f.assigned_technician_id), is_cold_storage: f.is_cold_storage,
      temp_min_c: n(f.temp_min_c), temp_max_c: n(f.temp_max_c), readings_per_day: Number(f.readings_per_day) || 2, notes: s(f.notes),
    }
    try {
      const r = e0 ? await q<{ id: string }>(supabase.from('equipment').update(row).eq('id', e0.id).select('id').single())
        : await q<{ id: string }>(supabase.from('equipment').insert(row).select('id').single())
      qc.invalidateQueries({ queryKey: ['equipment'] }); qc.invalidateQueries({ queryKey: ['today'] })
      toast(e0 ? 'Equipment updated' : 'Equipment added'); onSaved?.(r.id); onClose()
    } catch (e) { toast(friendlyError(e), { tone: 'error' }) } finally { setBusy(false) }
  }
  return (
    <Sheet open onClose={onClose} title={e0 ? 'Edit equipment' : 'New equipment'}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <fieldset className="fieldset"><legend className="label">Basics</legend>
        <Field label="Name *" htmlFor="e-name"><input id="e-name" className="input" value={f.name} onChange={set('name')} placeholder="e.g. Blood bank fridge" /></Field>
        <div className="row-fields">
          <Field label="Asset tag" htmlFor="e-tag"><input id="e-tag" className="input mono" value={f.asset_tag} onChange={set('asset_tag')} /></Field>
          <Field label="Category" htmlFor="e-cat"><input id="e-cat" className="input" value={f.category} onChange={set('category')} placeholder="Centrifuge, analyser…" /></Field>
        </div>
        <div className="row-fields">
          <Field label="Location" htmlFor="e-loc"><select id="e-loc" className="select" value={f.location_id} onChange={set('location_id')}><option value="">—</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
          <Field label="Status" htmlFor="e-st"><select id="e-st" className="select" value={f.status} onChange={set('status')}>
            <option value="operational">Operational</option><option value="due_service">Due service</option><option value="under_maintenance">Under maintenance</option><option value="out_of_service">Out of service</option><option value="retired">Retired</option></select></Field>
        </div>
        <Field label="Assigned technician" htmlFor="e-tech"><select id="e-tech" className="select" value={f.assigned_technician_id} onChange={set('assigned_technician_id')}><option value="">—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></Field>
      </fieldset>
      <fieldset className="fieldset"><legend className="label">Cold storage</legend>
        <label className="hstack" style={{ marginBottom: 16, cursor: 'pointer' }}>
          <input type="checkbox" checked={f.is_cold_storage} onChange={(e) => setF({ ...f, is_cold_storage: e.target.checked })} style={{ width: 20, height: 20 }} />
          <span>This is a fridge / freezer — log its temperature</span>
        </label>
        {f.is_cold_storage && <div className="row-fields" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <Field label="Min °C" htmlFor="e-min"><input id="e-min" className="input mono" inputMode="decimal" value={f.temp_min_c} onChange={set('temp_min_c')} /></Field>
          <Field label="Max °C" htmlFor="e-max"><input id="e-max" className="input mono" inputMode="decimal" value={f.temp_max_c} onChange={set('temp_max_c')} /></Field>
          <Field label="Checks/day" htmlFor="e-rpd"><input id="e-rpd" className="input mono" inputMode="numeric" value={f.readings_per_day} onChange={set('readings_per_day')} /></Field>
        </div>}
      </fieldset>
      <fieldset className="fieldset"><legend className="label">Service schedule</legend>
        <div className="row-fields">
          <Field label="Service every (days)" htmlFor="e-si"><input id="e-si" className="input mono" inputMode="numeric" value={f.service_interval_days} onChange={set('service_interval_days')} /></Field>
          <Field label="Next service" htmlFor="e-ns"><input id="e-ns" type="date" className="input" value={f.next_service_date} onChange={set('next_service_date')} /></Field>
        </div>
        <div className="row-fields">
          <Field label="Calibrate every (days)" htmlFor="e-ci"><input id="e-ci" className="input mono" inputMode="numeric" value={f.calibration_interval_days} onChange={set('calibration_interval_days')} /></Field>
          <Field label="Next calibration" htmlFor="e-nc"><input id="e-nc" type="date" className="input" value={f.next_calibration_date} onChange={set('next_calibration_date')} /></Field>
        </div>
      </fieldset>
      <fieldset className="fieldset"><legend className="label">Details</legend>
        <div className="row-fields">
          <Field label="Manufacturer" htmlFor="e-man"><input id="e-man" className="input" value={f.manufacturer} onChange={set('manufacturer')} /></Field>
          <Field label="Model" htmlFor="e-mod"><input id="e-mod" className="input" value={f.model} onChange={set('model')} /></Field>
        </div>
        <Field label="Serial number" htmlFor="e-sn"><input id="e-sn" className="input mono" value={f.serial_number} onChange={set('serial_number')} /></Field>
        <Field label="Notes" htmlFor="e-notes"><textarea id="e-notes" className="textarea" value={f.notes} onChange={set('notes')} /></Field>
      </fieldset>
    </Sheet>
  )
}
