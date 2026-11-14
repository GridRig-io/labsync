import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase, q, friendlyError } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { useToast } from '../../lib/toast'
import { useLocations } from '../../lib/data'
import type { Abo, BloodUnit, Component, Rh, Screening } from '../../lib/types'
import { Field, Seg, Sheet, Chips } from '../../components/ui'
import { addDaysISO, COMPONENTS, COMPONENT_LABEL, GROUPS, groupLabel, todayISO } from '../../lib/format'

export const SCREENS = [
  { key: 'screening_hiv', label: 'HIV 1/2' },
  { key: 'screening_hbsag', label: 'HBsAg' },
  { key: 'screening_hcv', label: 'HCV' },
  { key: 'screening_syphilis', label: 'Syphilis' },
] as const
type ScreenKey = (typeof SCREENS)[number]['key']

const SCREEN_OPTS: { value: Screening; label: string }[] = [
  { value: 'pending', label: 'Pending' }, { value: 'non_reactive', label: 'Non-reactive' }, { value: 'reactive', label: 'Reactive' },
]

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['blood'] }); qc.invalidateQueries({ queryKey: ['today'] })
}

export function BloodAddSheet({ onClose }: { onClose: () => void }) {
  const { lab } = useSession()
  const toast = useToast()
  const qc = useQueryClient()
  const { data: locations = [] } = useLocations()
  const [component, setComponent] = useState<Component>('packed_red_cells')
  const [group, setGroup] = useState<{ abo: Abo; rh: Rh } | null>(null)
  const [f, setF] = useState({ unit_number: '', volume_ml: '', collection_date: todayISO(), expiry_date: '', donor_code: '', location_id: '' })
  const [scr, setScr] = useState<Record<ScreenKey, Screening>>({ screening_hiv: 'pending', screening_hbsag: 'pending', screening_hcv: 'pending', screening_syphilis: 'pending' })
  const [expiryTouched, setExpiryTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState(0)

  // expiry = collection + component shelf life (editable)
  useEffect(() => {
    if (expiryTouched || !f.collection_date) return
    const days = lab?.blood_shelf_life_days?.[component] ?? 35
    setF((x) => ({ ...x, expiry_date: addDaysISO(x.collection_date, days) }))
  }, [component, f.collection_date, lab, expiryTouched])
  useEffect(() => {
    if (!f.location_id && locations.length) {
      const pref = locations.find((l) => /blood/i.test(l.name) && (component === 'fresh_frozen_plasma' || component === 'cryoprecipitate' ? l.kind === 'freezer' : l.kind === 'fridge'))
        ?? locations.find((l) => /blood/i.test(l.name))
      if (pref) setF((x) => ({ ...x, location_id: pref.id }))
    }
  }, [locations, component, f.location_id])

  const allClear = Object.values(scr).every((v) => v === 'non_reactive')
  const anyReactive = Object.values(scr).some((v) => v === 'reactive')

  const save = async (another: boolean) => {
    if (!f.unit_number.trim()) return toast('Enter the unit number', { tone: 'error' })
    if (!group) return toast('Choose the blood group', { tone: 'error' })
    setBusy(true)
    try {
      await q(supabase.from('blood_units').insert({
        unit_number: f.unit_number.trim().toUpperCase(), component, abo: group.abo, rh: group.rh,
        volume_ml: f.volume_ml ? Number(f.volume_ml) : null, collection_date: f.collection_date, expiry_date: f.expiry_date,
        donor_code: f.donor_code || null, location_id: f.location_id || null, ...scr, status: 'quarantine',
      }))
      invalidate(qc)
      setAdded((n) => n + 1)
      toast(`${f.unit_number.toUpperCase()} · ${groupLabel(group.abo, group.rh)} added to quarantine`)
      if (another) setF((x) => ({ ...x, unit_number: '', donor_code: '' }))
      else onClose()
    } catch (e) { toast(friendlyError(e), { tone: 'error' }) } finally { setBusy(false) }
  }

  return (
    <Sheet open onClose={onClose} title={`Add blood unit${added ? ` · ${added} added` : ''}`} wide
      footer={<>
        <button className="btn" disabled={busy} onClick={() => save(true)}>Save + next</button>
        <button className="btn primary" disabled={busy} onClick={() => save(false)}>{busy ? 'Saving…' : 'Save unit'}</button>
      </>}>
      <Field label="Unit number *" htmlFor="b-un"><input id="b-un" className="input mono" autoFocus value={f.unit_number} onChange={(e) => setF({ ...f, unit_number: e.target.value })} placeholder="Scan or type" style={{ fontSize: '1.2rem', textTransform: 'uppercase' }} /></Field>
      <Field label="Blood group *">
        <div className="blood-strip" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {GROUPS.map((g) => {
            const on = group?.abo === g.abo && group?.rh === g.rh
            return (
              <button key={groupLabel(g.abo, g.rh)} type="button" className="btile" onClick={() => setGroup(g)} aria-pressed={on}
                style={{ minHeight: 60, alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: 0, borderRight: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)', background: on ? 'var(--ink)' : undefined, color: on ? 'var(--paper)' : undefined }}>
                <span className="grp" style={{ fontSize: '1.5rem' }}>{groupLabel(g.abo, g.rh)}</span>
              </button>
            )
          })}
        </div>
      </Field>
      <Field label="Component">
        <Chips value={component} onChange={(c) => setComponent(c)} options={COMPONENTS.map((c) => ({ value: c, label: COMPONENT_LABEL[c] }))} />
      </Field>
      <div className="row-fields">
        <Field label="Collected" htmlFor="b-col"><input id="b-col" type="date" className="input" value={f.collection_date} onChange={(e) => setF({ ...f, collection_date: e.target.value })} /></Field>
        <Field label="Expires" htmlFor="b-exp" hint={expiryTouched ? 'Set manually' : `Auto: +${lab?.blood_shelf_life_days?.[component] ?? 35} days`}>
          <input id="b-exp" type="date" className="input" value={f.expiry_date} onChange={(e) => { setExpiryTouched(true); setF({ ...f, expiry_date: e.target.value }) }} /></Field>
      </div>
      <div className="row-fields">
        <Field label="Volume (mL)" htmlFor="b-vol"><input id="b-vol" className="input mono" inputMode="numeric" value={f.volume_ml} onChange={(e) => setF({ ...f, volume_ml: e.target.value })} /></Field>
        <Field label="Donor code" htmlFor="b-don" hint="Code only, no names"><input id="b-don" className="input mono" value={f.donor_code} onChange={(e) => setF({ ...f, donor_code: e.target.value })} /></Field>
      </div>
      <Field label="Storage" htmlFor="b-loc"><select id="b-loc" className="select" value={f.location_id} onChange={(e) => setF({ ...f, location_id: e.target.value })}><option value="">—</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
      <fieldset className="fieldset"><legend className="label">Screening</legend>
        {SCREENS.map((s) => (
          <div key={s.key} className="spread" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, minWidth: 80 }}>{s.label}</span>
            <Seg value={scr[s.key]} onChange={(v) => setScr({ ...scr, [s.key]: v })} options={SCREEN_OPTS} />
          </div>
        ))}
        <button type="button" className="btn sm" onClick={() => setScr({ screening_hiv: 'non_reactive', screening_hbsag: 'non_reactive', screening_hcv: 'non_reactive', screening_syphilis: 'non_reactive' })}>Mark all non-reactive</button>
        <p className="small muted" style={{ marginTop: 10 }}>
          {anyReactive ? <span className="c-red">A reactive result keeps the unit in quarantine.</span>
            : allClear ? 'All clear. Release the unit to available from its page after checks.' : 'New units start in quarantine until screening is complete.'}
        </p>
      </fieldset>
    </Sheet>
  )
}

export type BloodAction = 'release' | 'reserve' | 'issue' | 'return' | 'discard' | 'screening'
const TITLES: Record<BloodAction, string> = {
  release: 'Release to available', reserve: 'Reserve unit', issue: 'Issue unit', return: 'Return to stock', discard: 'Discard unit', screening: 'Update screening',
}

export function BloodActionSheet({ unit, action, onClose }: { unit: BloodUnit; action: BloodAction; onClose: () => void }) {
  const { lab } = useSession()
  const toast = useToast()
  const qc = useQueryClient()
  const [ref, setRef] = useState(unit.request_ref ?? '')
  const [to, setTo] = useState(unit.issued_to ?? '')
  const [hold, setHold] = useState(String(lab?.reservation_hold_hours ?? 48))
  const [reason, setReason] = useState('Expired')
  const [note, setNote] = useState('')
  const [scr, setScr] = useState<Record<ScreenKey, Screening>>({ screening_hiv: unit.screening_hiv, screening_hbsag: unit.screening_hbsag, screening_hcv: unit.screening_hcv, screening_syphilis: unit.screening_syphilis })
  const [busy, setBusy] = useState(false)

  const save = async () => {
    let patch: Partial<BloodUnit> & Record<string, unknown> = {}
    if (action === 'release') patch = { status: 'available' }
    if (action === 'reserve') {
      if (!ref.trim()) return toast('Enter the request / crossmatch reference', { tone: 'error' })
      patch = { status: 'reserved', request_ref: ref.trim(), reserved_until: new Date(Date.now() + Number(hold || 48) * 3600_000).toISOString() }
    }
    if (action === 'issue') {
      if (!to.trim()) return toast('Enter the ward or department', { tone: 'error' })
      patch = { status: 'issued', request_ref: ref.trim() || null, issued_to: to.trim() }
    }
    if (action === 'return') patch = { status: unit.status === 'issued' ? 'available' : 'available', request_ref: null, issued_to: null, issued_at: null }
    if (action === 'discard') {
      if (reason === 'Other' && !note.trim()) return toast('Add a note for the discard reason', { tone: 'error' })
      patch = { status: 'discarded', discard_reason: [reason, note].filter(Boolean).join(' — ') }
    }
    if (action === 'screening') patch = { ...scr }
    setBusy(true)
    try {
      await q(supabase.from('blood_units').update(patch).eq('id', unit.id))
      invalidate(qc)
      toast(`${unit.unit_number}: ${TITLES[action].toLowerCase()} done`)
      onClose()
    } catch (e) { toast(friendlyError(e), { tone: 'error' }) } finally { setBusy(false) }
  }

  return (
    <Sheet open onClose={onClose} title={`${TITLES[action]} · ${unit.unit_number}`}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className={`btn ${action === 'discard' ? 'danger' : 'primary'}`} disabled={busy} onClick={save}>{busy ? 'Saving…' : TITLES[action]}</button></>}>
      {action === 'release' && <p>All four screens are non-reactive. Releasing makes <b>{groupLabel(unit.abo, unit.rh)} {COMPONENT_LABEL[unit.component]}</b> available for crossmatch and issue.</p>}
      {action === 'reserve' && <>
        <Field label="Request / crossmatch ref *" htmlFor="r-ref" hint="No patient names in this build"><input id="r-ref" className="input mono" value={ref} onChange={(e) => setRef(e.target.value)} autoFocus /></Field>
        <Field label="Hold for (hours)" htmlFor="r-hold" hint="Goes back to available automatically after this"><input id="r-hold" className="input mono" inputMode="numeric" value={hold} onChange={(e) => setHold(e.target.value)} /></Field>
      </>}
      {action === 'issue' && <>
        <Field label="Issued to (ward / department) *" htmlFor="i-to"><input id="i-to" className="input" value={to} onChange={(e) => setTo(e.target.value)} autoFocus placeholder="e.g. Maternity, A&E, Theatre" /></Field>
        <Field label="Request ref" htmlFor="i-ref"><input id="i-ref" className="input mono" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      </>}
      {action === 'return' && <p>Return {unit.unit_number} to available stock. Only do this if the cold chain was kept.</p>}
      {action === 'discard' && <>
        <Field label="Reason"><Chips value={reason} onChange={setReason} options={['Expired', 'Reactive screening', 'Haemolysed', 'Bag damaged / leaking', 'Cold chain break', 'Other'].map((r) => ({ value: r, label: r }))} /></Field>
        <Field label={reason === 'Other' ? 'Note *' : 'Note'} htmlFor="d-note"><textarea id="d-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </>}
      {action === 'screening' && SCREENS.map((s) => (
        <div key={s.key} className="spread" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, minWidth: 80 }}>{s.label}</span>
          <Seg value={scr[s.key]} onChange={(v) => setScr({ ...scr, [s.key]: v })} options={SCREEN_OPTS} />
        </div>
      ))}
    </Sheet>
  )
}
