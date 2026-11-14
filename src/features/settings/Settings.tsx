import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { supabase, q, friendlyError } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { useToast } from '../../lib/toast'
import { useCategories, useLocations, usePeople, usePeopleMap, useSuppliers } from '../../lib/data'
import type { Component, Role } from '../../lib/types'
import { Avatar, Field, PageHead, Section, Seg, Sheet, SkeletonRows, Tag } from '../../components/ui'
import { COMPONENTS, COMPONENT_LABEL, COMPONENT_SHORT, fmtDateTime, GROUPS, groupLabel, ROLE_LABEL } from '../../lib/format'

export default function Settings() {
  const { can } = useSession()
  const tabs = [
    { to: 'me', label: 'Me', show: true },
    { to: 'lab', label: 'Lab', show: can('admin') },
    { to: 'staff', label: 'Staff', show: can('admin') },
    { to: 'lists', label: 'Lists', show: can('inventory.write') },
    { to: 'blood', label: 'Blood minimums', show: can('blood.minimums') },
    { to: 'audit', label: 'Audit log', show: can('admin') },
  ].filter((t) => t.show)
  return (
    <>
      <PageHead kicker="06 · Settings" title="Settings" />
      <div className="chips" style={{ marginBottom: 24 }}>
        {tabs.map((t) => <NavLink key={t.to} to={t.to} className={({ isActive }) => `chip ${isActive ? 'on' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>{t.label}</NavLink>)}
      </div>
      <div style={{ maxWidth: 760 }}>
        <Routes>
          <Route index element={<Navigate to="me" replace />} />
          <Route path="me" element={<Me />} />
          {can('admin') && <Route path="lab" element={<LabProfile />} />}
          {can('admin') && <Route path="staff" element={<Staff />} />}
          {can('inventory.write') && <Route path="lists" element={<Lists />} />}
          {can('blood.minimums') && <Route path="blood" element={<BloodMinimums />} />}
          {can('admin') && <Route path="audit" element={<Audit />} />}
          <Route path="*" element={<Navigate to="me" replace />} />
        </Routes>
      </div>
    </>
  )
}

/* ---------- me & appearance ---------- */
function applyPrefs(p: { theme?: string; size?: string; density?: string }) {
  const theme = p.theme ?? 'system'
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.documentElement.dataset.size = p.size ?? 'default'
  document.documentElement.dataset.density = p.density ?? 'comfortable'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#121210' : '#141414')
}

function Me() {
  const { profile, lab } = useSession()
  const toast = useToast()
  const qc = useQueryClient()
  const [name, setName] = useState(profile?.full_name ?? '')
  const [title, setTitle] = useState(profile?.job_title ?? '')
  const [theme, setTheme] = useState(localStorage.getItem('ls-theme') ?? 'system')
  const [size, setSize] = useState(localStorage.getItem('ls-size') ?? 'default')
  const [density, setDensity] = useState(localStorage.getItem('ls-density') ?? 'comfortable')
  const [mute, setMute] = useState(localStorage.getItem('ls-mute') === '1')
  const [idle, setIdle] = useState(localStorage.getItem('ls-idle') ?? '30')
  const [pw, setPw] = useState('')

  useEffect(() => {
    localStorage.setItem('ls-theme', theme); localStorage.setItem('ls-size', size); localStorage.setItem('ls-density', density)
    localStorage.setItem('ls-mute', mute ? '1' : '0'); localStorage.setItem('ls-idle', idle)
    applyPrefs({ theme, size, density })
  }, [theme, size, density, mute, idle])

  const saveProfile = async () => {
    try {
      await q(supabase.from('profiles').update({ full_name: name.trim(), job_title: title.trim() || null, preferences: { theme, size, density, mute } }).eq('id', profile!.id))
      qc.invalidateQueries({ queryKey: ['me'] }); qc.invalidateQueries({ queryKey: ['lists', 'people'] }); toast('Profile saved')
    } catch (e) { toast(friendlyError(e), { tone: 'error' }) }
  }
  const changePw = async () => {
    if (pw.length < 8) return toast('Use at least 8 characters', { tone: 'error' })
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (error) toast(friendlyError(error), { tone: 'error' }); else { setPw(''); toast('Password changed') }
  }
  return (
    <>
      <Section title="Profile">
        <div style={{ paddingTop: 16 }}>
          <div className="hstack" style={{ marginBottom: 16 }}><Avatar name={name} lg /><div><b>{profile?.email}</b><div className="small muted">{profile && ROLE_LABEL[profile.role]} · {lab?.name}</div></div></div>
          <div className="row-fields">
            <Field label="Full name" htmlFor="me-n"><input id="me-n" className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Job title" htmlFor="me-t"><input id="me-t" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Medical lab scientist" /></Field>
          </div>
          <button className="btn primary" onClick={saveProfile}>Save profile</button>
        </div>
      </Section>
      <Section title="Appearance · this device">
        <div style={{ paddingTop: 16 }}>
          <Field label="Theme"><Seg value={theme} onChange={setTheme} options={[{ value: 'light', label: 'Paper' }, { value: 'dark', label: 'Night shift' }, { value: 'system', label: 'Auto' }]} /></Field>
          <Field label="Text size"><Seg value={size} onChange={setSize} options={[{ value: 'small', label: 'S' }, { value: 'default', label: 'M' }, { value: 'large', label: 'L' }, { value: 'xl', label: 'XL' }]} /></Field>
          <Field label="Row density"><Seg value={density} onChange={setDensity} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} /></Field>
        </div>
      </Section>
      <Section title="Alerts & security">
        <div style={{ paddingTop: 16 }}>
          <label className="hstack" style={{ marginBottom: 16, cursor: 'pointer' }}><input type="checkbox" checked={!mute} onChange={(e) => setMute(!e.target.checked)} style={{ width: 20, height: 20 }} /> Play a sound for new alerts while the app is open</label>
          <Field label="Sign out after inactivity" hint="Shorter is safer on shared lab computers"><Seg value={idle} onChange={setIdle} options={[{ value: '10', label: '10 min' }, { value: '30', label: '30 min' }, { value: '120', label: '2 h' }, { value: '720', label: '12 h' }]} /></Field>
          <Field label="Change password" htmlFor="me-pw"><div className="hstack" style={{ flexWrap: 'nowrap' }}><input id="me-pw" type="password" autoComplete="new-password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (8+ characters)" /><button className="btn" onClick={changePw}>Change</button></div></Field>
          <p className="small faint">LabSync v3 · Bench Ledger</p>
        </div>
      </Section>
    </>
  )
}

/* ---------- lab profile ---------- */
function LabProfile() {
  const { lab, logoUrl } = useSession()
  const toast = useToast()
  const qc = useQueryClient()
  const [f, setF] = useState({ name: '', short_code: '', timezone: 'Africa/Lagos', expiry_warning_days: 30, blood_expiry_warning_days: 3, reservation_hold_hours: 48 })
  const [shelf, setShelf] = useState<Record<Component, number>>({} as Record<Component, number>)
  useEffect(() => {
    if (lab) {
      setF({ name: lab.name, short_code: lab.short_code ?? '', timezone: lab.timezone, expiry_warning_days: lab.expiry_warning_days, blood_expiry_warning_days: lab.blood_expiry_warning_days, reservation_hold_hours: lab.reservation_hold_hours })
      setShelf(lab.blood_shelf_life_days)
    }
  }, [lab])
  if (!lab) return <SkeletonRows />
  const save = async () => {
    try {
      await q(supabase.from('labs').update({ ...f, short_code: f.short_code.trim().toUpperCase() || null, blood_shelf_life_days: shelf }).eq('id', lab.id))
      qc.invalidateQueries({ queryKey: ['lab'] }); toast('Lab settings saved')
    } catch (e) { toast(friendlyError(e), { tone: 'error' }) }
  }
  const upload = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
    const path = `${lab.id}/logo-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('branding').upload(path, file, { upsert: true, contentType: file.type })
    if (error) return toast(friendlyError(error), { tone: 'error' })
    await supabase.from('labs').update({ logo_path: path }).eq('id', lab.id)
    qc.invalidateQueries({ queryKey: ['lab'] }); toast('Logo updated')
  }
  const num = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: Number(e.target.value) || 0 })
  return (
    <>
      <Section title="Laboratory">
        <div style={{ paddingTop: 16 }}>
          <Field label="Lab name" htmlFor="l-n"><input id="l-n" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <div className="row-fields">
            <Field label="Short code" htmlFor="l-c" hint="Shown in headers, e.g. SAML"><input id="l-c" className="input mono" maxLength={8} value={f.short_code} onChange={(e) => setF({ ...f, short_code: e.target.value })} /></Field>
            <Field label="Timezone" htmlFor="l-tz"><select id="l-tz" className="select" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
              {['Africa/Lagos', 'Africa/Accra', 'Africa/Nairobi', 'Africa/Johannesburg', 'Africa/Cairo', 'Europe/London', 'UTC'].map((z) => <option key={z}>{z}</option>)}</select></Field>
          </div>
          <Field label="Logo">
            <div className="hstack">
              {logoUrl && <img src={logoUrl} alt="Current logo" style={{ height: 40, border: '1px solid var(--rule)', padding: 4, background: '#fff' }} />}
              <label className="btn sm" style={{ cursor: 'pointer' }}>Upload logo<input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
              <span className="small faint">PNG / SVG, under 1 MB</span>
            </div>
          </Field>
        </div>
      </Section>
      <Section title="Alerts">
        <div className="row-fields" style={{ paddingTop: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <Field label="Stock expiry warning" hint="Days before expiry" htmlFor="l-ew"><input id="l-ew" className="input mono" inputMode="numeric" value={f.expiry_warning_days} onChange={num('expiry_warning_days')} /></Field>
          <Field label="Blood expiry warning" hint="Days before expiry" htmlFor="l-bw"><input id="l-bw" className="input mono" inputMode="numeric" value={f.blood_expiry_warning_days} onChange={num('blood_expiry_warning_days')} /></Field>
          <Field label="Reservation hold" hint="Hours before auto-release" htmlFor="l-rh"><input id="l-rh" className="input mono" inputMode="numeric" value={f.reservation_hold_hours} onChange={num('reservation_hold_hours')} /></Field>
        </div>
      </Section>
      <Section title="Blood shelf life · days">
        <p className="small muted" style={{ padding: '10px 0' }}>Used to pre-fill expiry when adding a unit. Set these to your SOP (depends on anticoagulant and storage).</p>
        <div className="row-fields" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
          {COMPONENTS.map((c) => <Field key={c} label={COMPONENT_SHORT[c]} hint={COMPONENT_LABEL[c]} htmlFor={`sl-${c}`}><input id={`sl-${c}`} className="input mono" inputMode="numeric" value={shelf[c] ?? ''} onChange={(e) => setShelf({ ...shelf, [c]: Number(e.target.value) || 0 })} /></Field>)}
        </div>
      </Section>
      <button className="btn primary" onClick={save}>Save lab settings</button>
    </>
  )
}

/* ---------- staff ---------- */
function genPassword() {
  const words = ['Amber', 'Basil', 'Cedar', 'Delta', 'Ember', 'Flint', 'Gamma', 'Harbor', 'Indigo', 'Juniper', 'Kola', 'Lumen', 'Mango', 'Niger', 'Onyx', 'Pepper']
  const a = new Uint32Array(3); crypto.getRandomValues(a)
  return `${words[a[0]! % words.length]}-${words[a[1]! % words.length]}-${(a[2]! % 900) + 100}`
}

function Staff() {
  const { profile } = useSession()
  const toast = useToast()
  const qc = useQueryClient()
  const { data: people, isLoading } = usePeople()
  const [add, setAdd] = useState(false)
  const [reset, setReset] = useState<{ id: string; name: string } | null>(null)
  const [f, setF] = useState({ full_name: '', email: '', role: 'staff' as Role, job_title: '', password: genPassword() })
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['lists', 'people'] })

  const update = async (id: string, patch: Record<string, unknown>, msg: string) => {
    try { await q(supabase.from('profiles').update(patch).eq('id', id)); refresh(); toast(msg) } catch (e) { toast(friendlyError(e), { tone: 'error' }) }
  }
  const invoke = async (body: Record<string, string>) => {
    const { data, error } = await supabase.functions.invoke('manage-staff', { body })
    if (error) {
      let msg = error.message
      try { const ctx = (error as unknown as { context?: Response }).context; if (ctx) msg = (await ctx.json()).error ?? msg } catch { /* keep message */ }
      throw new Error(msg)
    }
    return data
  }
  const create = async () => {
    setBusy(true)
    try {
      await invoke({ action: 'create', ...f })
      refresh(); setCreated({ email: f.email, password: f.password }); setAdd(false)
      setF({ full_name: '', email: '', role: 'staff', job_title: '', password: genPassword() })
    } catch (e) { toast((e as Error).message, { tone: 'error' }) } finally { setBusy(false) }
  }
  const doReset = async () => {
    if (!reset) return
    const pw = genPassword(); setBusy(true)
    try { await invoke({ action: 'reset_password', user_id: reset.id, password: pw }); setCreated({ email: reset.name, password: pw }); setReset(null) }
    catch (e) { toast((e as Error).message, { tone: 'error' }) } finally { setBusy(false) }
  }

  return (
    <>
      <Section title="Staff accounts" count={people?.length} action={<button className="linkish" onClick={() => setAdd(true)}>+ Add staff</button>}>
        {isLoading ? <SkeletonRows /> : (
          <ul className="ledger">
            {people?.map((p) => (
              <li key={p.id} className="row" style={{ gridTemplateColumns: '28px minmax(0,1fr) auto', opacity: p.is_active ? 1 : 0.55 }}>
                <Avatar name={p.full_name} />
                <span style={{ minWidth: 0 }}>
                  <span className="main-line" style={{ display: 'block' }}>{p.full_name}{p.id === profile?.id ? ' (you)' : ''}{!p.is_active && <> <Tag>Deactivated</Tag></>}</span>
                  <span className="sub-line" style={{ display: 'block' }}>{p.email}{p.job_title ? ` · ${p.job_title}` : ''}</span>
                </span>
                <span className="end">
                  <select className="select" style={{ width: 'auto', minHeight: 36, padding: '4px 30px 4px 8px', fontSize: '0.85rem' }} value={p.role} aria-label={`Role for ${p.full_name}`}
                    onChange={(e) => update(p.id, { role: e.target.value }, `${p.full_name}: ${ROLE_LABEL[e.target.value as Role]}`)}>
                    {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                  {p.id !== profile?.id && <>
                    <button className="btn sm" onClick={() => setReset({ id: p.id, name: p.email ?? p.full_name ?? '' })}>Reset password</button>
                    <button className="btn sm ghost" onClick={() => update(p.id, { is_active: !p.is_active }, p.is_active ? 'Account deactivated' : 'Account reactivated')}>{p.is_active ? 'Deactivate' : 'Reactivate'}</button>
                  </>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <div className="panel small">
        <b>Roles</b>
        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          <li><b>Director / Admin</b> — everything, including staff, lab settings and audit log.</li>
          <li><b>Supervisor</b> — stock, blood bank, equipment; assigns tasks to anyone.</li>
          <li><b>Inventory officer</b> — receives, adjusts and discards stock; manages blood units.</li>
          <li><b>Staff</b> — records stock usage, logs temperatures, works on own tasks.</li>
        </ul>
      </div>

      <Sheet open={add} onClose={() => setAdd(false)} title="Add staff member"
        footer={<><button className="btn" onClick={() => setAdd(false)}>Cancel</button><button className="btn primary" disabled={busy || !f.email || !f.full_name} onClick={create}>{busy ? 'Creating…' : 'Create account'}</button></>}>
        <Field label="Full name *" htmlFor="s-n"><input id="s-n" className="input" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="Email *" htmlFor="s-e" hint="They sign in with this"><input id="s-e" type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <div className="row-fields">
          <Field label="Role" htmlFor="s-r"><select id="s-r" className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
          <Field label="Job title" htmlFor="s-j"><input id="s-j" className="input" value={f.job_title} onChange={(e) => setF({ ...f, job_title: e.target.value })} /></Field>
        </div>
        <Field label="Temporary password" htmlFor="s-p" hint="Share it privately. They can change it in Settings → Me.">
          <div className="hstack" style={{ flexWrap: 'nowrap' }}><input id="s-p" className="input mono" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /><button className="btn" type="button" onClick={() => setF({ ...f, password: genPassword() })}>New</button></div>
        </Field>
      </Sheet>
      <Sheet open={!!reset} onClose={() => setReset(null)} title="Reset password"
        footer={<><button className="btn" onClick={() => setReset(null)}>Cancel</button><button className="btn primary" disabled={busy} onClick={doReset}>Generate new password</button></>}>
        <p>Create a new temporary password for <b>{reset?.name}</b>? Their current password stops working.</p>
      </Sheet>
      <Sheet open={!!created} onClose={() => setCreated(null)} title="Sign-in details" footer={<button className="btn primary" onClick={() => setCreated(null)}>Done</button>}>
        <p style={{ marginBottom: 12 }}>Give these to the staff member privately. This password won't be shown again.</p>
        <dl className="spec"><dt>Sign in at</dt><dd className="mono">{location.origin}</dd><dt>Email</dt><dd className="mono">{created?.email}</dd><dt>Password</dt><dd className="mono" style={{ fontSize: '1.2rem' }}>{created?.password}</dd></dl>
        <button className="btn sm" style={{ marginTop: 12 }} onClick={() => navigator.clipboard?.writeText(`LabSync\n${location.origin}\nEmail: ${created?.email}\nPassword: ${created?.password}`).then(() => toast('Copied'))}>Copy details</button>
      </Sheet>
    </>
  )
}

/* ---------- reference lists ---------- */
function ListEditor({ table, title, rows, extra }: { table: 'categories' | 'locations' | 'suppliers'; title: string; rows: { id: string; name: string; kind?: string }[]; extra?: 'kind' }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [kind, setKind] = useState('store')
  const refresh = () => qc.invalidateQueries({ queryKey: ['lists', table] })
  const add = async () => {
    if (!name.trim()) return
    try { await q(supabase.from(table).insert(extra ? { name: name.trim(), kind } : { name: name.trim() })); setName(''); refresh() } catch (e) { toast(friendlyError(e), { tone: 'error' }) }
  }
  const rename = async (id: string, old: string) => {
    const n = prompt('New name', old); if (!n?.trim() || n === old) return
    try { await q(supabase.from(table).update({ name: n.trim() }).eq('id', id)); refresh() } catch (e) { toast(friendlyError(e), { tone: 'error' }) }
  }
  const del = async (id: string, n: string) => {
    if (!confirm(`Delete "${n}"? Items using it will show "—".`)) return
    try { await q(supabase.from(table).delete().eq('id', id)); refresh() } catch (e) { toast(friendlyError(e), { tone: 'error' }) }
  }
  return (
    <Section title={title} count={rows.length}>
      <ul className="ledger">
        {rows.map((r) => (
          <li key={r.id} className="row no-mark">
            <button className="main-line" style={{ background: 'none', border: 0, textAlign: 'left', cursor: 'pointer', padding: 0 }} onClick={() => rename(r.id, r.name)}>{r.name}{r.kind ? <span className="faint small"> · {r.kind}</span> : null}</button>
            <button className="icon-btn" aria-label={`Delete ${r.name}`} onClick={() => del(r.id, r.name)}><Trash2 size={16} /></button>
          </li>
        ))}
      </ul>
      <div className="hstack" style={{ marginTop: 8, flexWrap: 'nowrap' }}>
        <input className="input" placeholder={`Add to ${title.toLowerCase()}`} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        {extra && <select className="select" style={{ width: 120 }} value={kind} onChange={(e) => setKind(e.target.value)}>{['store', 'shelf', 'bench', 'fridge', 'freezer', 'room'].map((k) => <option key={k}>{k}</option>)}</select>}
        <button className="btn" onClick={add}>Add</button>
      </div>
    </Section>
  )
}
function Lists() {
  const { data: cats = [] } = useCategories()
  const { data: locs = [] } = useLocations()
  const { data: sups = [] } = useSuppliers()
  return (
    <>
      <p className="small muted" style={{ marginBottom: 16 }}>Tap a name to rename it.</p>
      <ListEditor table="categories" title="Categories" rows={cats} />
      <ListEditor table="locations" title="Storage locations" rows={locs} extra="kind" />
      <ListEditor table="suppliers" title="Suppliers" rows={sups} />
    </>
  )
}

/* ---------- blood minimums ---------- */
function BloodMinimums() {
  const toast = useToast()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['blood', 'minimums'], queryFn: () => q<{ abo: string; rh: string; component: Component; min_units: number }[]>(supabase.from('blood_stock_minimums').select('abo,rh,component,min_units')) })
  const [vals, setVals] = useState<Record<string, number>>({})
  useEffect(() => { if (data) setVals(Object.fromEntries(data.map((d) => [`${d.abo}|${d.rh}|${d.component}`, d.min_units]))) }, [data])
  if (isLoading) return <SkeletonRows />
  const save = async () => {
    const rows = Object.entries(vals).map(([k, v]) => { const [abo, rh, component] = k.split('|'); return { abo, rh, component, min_units: v } })
    try { await q(supabase.from('blood_stock_minimums').upsert(rows, { onConflict: 'lab_id,abo,rh,component' })); qc.invalidateQueries({ queryKey: ['blood'] }); toast('Minimums saved') }
    catch (e) { toast(friendlyError(e), { tone: 'error' }) }
  }
  return (
    <Section title="Minimum units to keep available">
      <p className="small muted" style={{ padding: '10px 0' }}>When available stock falls below these numbers, LabSync raises a daily alert and shows a red banner in the blood bank.</p>
      <div style={{ overflowX: 'auto' }}>
        <table className="matrix">
          <thead><tr><th />{COMPONENTS.map((c) => <th key={c}>{COMPONENT_SHORT[c]}</th>)}</tr></thead>
          <tbody>{GROUPS.map((g) => (
            <tr key={g.abo + g.rh}><th scope="row">{groupLabel(g.abo, g.rh)}</th>
              {COMPONENTS.map((c) => {
                const k = `${g.abo}|${g.rh}|${c}`
                return <td key={c}><input aria-label={`${groupLabel(g.abo, g.rh)} ${COMPONENT_LABEL[c]} minimum`} className="mono" inputMode="numeric" value={vals[k] ?? 0}
                  onChange={(e) => setVals({ ...vals, [k]: Math.max(0, parseInt(e.target.value) || 0) })}
                  style={{ width: '100%', border: 0, background: 'transparent', textAlign: 'center', padding: '10px 4px', fontSize: '1rem' }} /></td>
              })}</tr>))}</tbody>
        </table>
      </div>
      <button className="btn primary" style={{ marginTop: 16 }} onClick={save}>Save minimums</button>
    </Section>
  )
}

/* ---------- audit log ---------- */
function Audit() {
  const people = usePeopleMap()
  const [table, setTable] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ['audit', table],
    queryFn: () => { let qy = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(150); if (table) qy = qy.eq('table_name', table); return q<{ id: number; table_name: string; record_id: string; action: string; actor_id: string | null; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null; created_at: string }[]>(qy) },
  })
  const diff = (a: Record<string, unknown> | null, b: Record<string, unknown> | null) => {
    const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].filter((k) => !['updated_at', 'created_at'].includes(k))
    return keys.filter((k) => JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])).map((k) => ({ k, from: a?.[k], to: b?.[k] }))
  }
  return (
    <Section title="Audit log">
      <div style={{ padding: '12px 0' }}>
        <select className="select" style={{ width: 'auto' }} value={table} onChange={(e) => setTable(e.target.value)} aria-label="Filter by area">
          <option value="">All areas</option>{['items', 'stock_lots', 'stock_movements', 'blood_units', 'equipment', 'maintenance_logs', 'tasks', 'profiles', 'labs', 'blood_stock_minimums', 'categories', 'locations', 'suppliers'].map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
      </div>
      {isLoading ? <SkeletonRows /> : (
        <ul className="ledger">
          {data?.map((r) => (
            <li key={r.id}>
              <button className="row no-mark" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                <span style={{ minWidth: 0 }}>
                  <span className="main-line" style={{ display: 'block' }}><b>{r.action}</b> · {r.table_name.replace(/_/g, ' ')} {String((r.new_data ?? r.old_data)?.name ?? (r.new_data ?? r.old_data)?.title ?? (r.new_data ?? r.old_data)?.unit_number ?? '')}</span>
                  <span className="sub-line" style={{ display: 'block' }}>{people.get(r.actor_id ?? '')?.full_name ?? 'System'} · {fmtDateTime(r.created_at)}</span>
                </span>
              </button>
              {openId === r.id && (
                <div className="panel mono small" style={{ marginBottom: 8, overflowX: 'auto' }}>
                  {diff(r.old_data, r.new_data).map((d) => (
                    <div key={d.k} style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 8, padding: '3px 0', borderBottom: '1px solid var(--rule)' }}>
                      <span className="faint">{d.k}</span>
                      <span>{r.action !== 'insert' && <span className="c-red" style={{ textDecoration: 'line-through' }}>{JSON.stringify(d.from)}</span>} {r.action !== 'delete' && <span className="c-green">{JSON.stringify(d.to)}</span>}</span>
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
