import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bell, ScanLine, Plus, LayoutList, Package, Droplet, ClipboardCheck, MoreHorizontal,
  Thermometer, Settings as Cog, LogOut, Wrench,
} from 'lucide-react'
import { supabase, q } from '../lib/supabase'
import { useSession } from '../lib/session'
import { useActions } from '../lib/actions'
import { useToast } from '../lib/toast'
import type { Notification } from '../lib/types'
import { Avatar, Mark, Sheet } from './ui'
import { relTime, ROLE_LABEL } from '../lib/format'
import { QuickSheets } from './QuickSheets'

const NAV = [
  { to: '/', label: 'Today', icon: LayoutList, end: true },
  { to: '/inventory', label: 'Inventory', icon: Package },
  { to: '/blood', label: 'Blood bank', icon: Droplet },
  { to: '/equipment', label: 'Equipment', icon: Thermometer },
  { to: '/tasks', label: 'Tasks', icon: ClipboardCheck },
  { to: '/settings', label: 'Settings', icon: Cog },
]

export function useNotifications() {
  const { session } = useSession()
  return useQuery({
    queryKey: ['notifications'],
    enabled: !!session,
    queryFn: () => q<Notification[]>(supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(60)),
  })
}

function playTone(severity: string) {
  try {
    if (localStorage.getItem('ls-mute') === '1') return
    const ctx = new AudioContext()
    const notes = severity === 'critical' ? [880, 660, 880] : [660, 880]
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain()
      o.type = 'sine'; o.frequency.value = f
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.16)
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + i * 0.16 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.16 + 0.14)
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + i * 0.16); o.stop(ctx.currentTime + i * 0.16 + 0.15)
    })
    if (severity === 'critical') navigator.vibrate?.([120, 60, 120])
  } catch { /* audio unavailable */ }
}

export function NotificationList({ items, onPick }: { items: Notification[]; onPick: (n: Notification) => void }) {
  const qc = useQueryClient()
  const unread = items.filter((n) => !n.read_at)
  const markAll = async () => {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null)
    qc.invalidateQueries({ queryKey: ['notifications'] })
  }
  return (
    <div>
      <div className="spread" style={{ padding: '10px 16px', borderBottom: '1px solid var(--ink)' }}>
        <span className="label">Alerts · {unread.length} unread</span>
        {unread.length > 0 && <button className="btn ghost sm" onClick={markAll}>Mark all read</button>}
      </div>
      {items.length === 0 && <p className="muted" style={{ padding: 16 }}>No alerts yet. They appear here when stock, blood, equipment or tasks need attention.</p>}
      <ul className="ledger">
        {items.map((n) => (
          <li key={n.id}>
            <button className="row" style={{ padding: '10px 16px', opacity: n.read_at ? 0.6 : 1 }} onClick={() => onPick(n)}>
              <Mark tone={n.severity === 'critical' ? 'critical' : n.severity === 'warning' ? 'warning' : 'info'} />
              <span style={{ minWidth: 0 }}>
                <span className="main-line" style={{ display: 'block', whiteSpace: 'normal', fontWeight: n.read_at ? 400 : 600 }}>{n.title}</span>
                {n.body && <span className="sub-line" style={{ display: 'block', whiteSpace: 'normal' }}>{n.body}</span>}
              </span>
              <span className="end mono faint small">{relTime(n.created_at)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Bell_() {
  const { data = [] } = useNotifications()
  const [open, setOpen] = useState(false)
  const nav = useNavigate()
  const qc = useQueryClient()
  const wrap = useRef<HTMLDivElement>(null)
  const seen = useRef<Set<string> | null>(null)
  const unread = data.filter((n) => !n.read_at).length

  // tone for genuinely new alerts that arrive while the app is open
  useEffect(() => {
    if (!data.length) return
    if (seen.current) {
      const fresh = data.filter((n) => !seen.current!.has(n.id) && !n.read_at)
      if (fresh.length) playTone(fresh.some((n) => n.severity === 'critical') ? 'critical' : 'info')
    }
    seen.current = new Set(data.map((n) => n.id))
  }, [data])

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const pick = async (n: Notification) => {
    setOpen(false)
    if (!n.read_at) {
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id)
      qc.invalidateQueries({ queryKey: ['notifications'] })
    }
    if (n.link) nav(n.link)
  }

  const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches
  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <button className="icon-btn" aria-label={`Alerts, ${unread} unread`} onClick={() => setOpen((o) => !o)}>
        <Bell size={21} />
        {unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && isDesktop && <div className="notif-panel"><NotificationList items={data} onPick={pick} /></div>}
      {!isDesktop && (
        <Sheet open={open} onClose={() => setOpen(false)} title="Alerts">
          <div style={{ margin: -20 }}><NotificationList items={data} onPick={pick} /></div>
        </Sheet>
      )}
    </div>
  )
}

function useIdleSignOut(minutes = 30) {
  const toast = useToast()
  useEffect(() => {
    let last = Date.now(); let warned = false
    const bump = () => { last = Date.now(); warned = false }
    const evts = ['pointerdown', 'keydown', 'scroll', 'touchstart']
    evts.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    const t = setInterval(() => {
      const idle = (Date.now() - last) / 60000
      if (idle > minutes - 1 && !warned) { warned = true; toast?.('You will be signed out in 1 minute for inactivity') }
      if (idle > minutes) supabase.auth.signOut()
    }, 15000)
    return () => { clearInterval(t); evts.forEach((e) => window.removeEventListener(e, bump)) }
  }, [minutes, toast])
}

export function Layout() {
  const { lab, profile, logoUrl } = useSession()
  const { open } = useActions()
  const { data: notes = [] } = useNotifications()
  const loc = useLocation()
  const nav = useNavigate()
  const [more, setMore] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  useIdleSignOut(Number(localStorage.getItem('ls-idle') || 30))

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  useEffect(() => { window.scrollTo(0, 0); setMore(false) }, [loc.pathname])

  // Ctrl/⌘+K → scan / lookup
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open({ kind: 'scan' }) } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open])

  const critical = notes.filter((n) => !n.read_at && n.severity === 'critical').length
  const code = lab?.short_code || 'LAB'

  return (
    <div className={`app ${loc.pathname.startsWith('/settings') ? 'no-fab' : ''}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="side-head">
          {logoUrl ? <img src={logoUrl} alt="" style={{ height: 32, width: 'auto', marginBottom: 8 }} /> : null}
          <div className="label" style={{ color: 'var(--ink)' }}>LabSync <span className="c-red">■</span> {code}</div>
          <div className="lab">{lab?.name}</div>
        </div>
        <nav className="side-nav">
          {NAV.map((n, i) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
              <span className="idx">{String(i + 1).padStart(2, '0')}</span>
              <span>{n.label}</span>
              {n.to === '/' && critical > 0 ? <span className="count">{critical}</span> : <span />}
            </NavLink>
          ))}
          <div style={{ padding: '16px 20px 8px' }} className="label">Record</div>
          <div style={{ padding: '0 20px', display: 'grid', gap: 6 }}>
            <button className="btn primary sm" onClick={() => open({ kind: 'use' })}>Use stock</button>
            <button className="btn sm" onClick={() => open({ kind: 'temp' })}>Log temperature</button>
            <button className="btn sm" onClick={() => open({ kind: 'quick' })}>More…</button>
          </div>
        </nav>
        <div className="side-foot">
          <div className="hstack" style={{ flexWrap: 'nowrap' }}>
            <Avatar name={profile?.full_name} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="small" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile?.full_name}</div>
              <div className="label" style={{ fontSize: '0.64rem' }}>{profile ? ROLE_LABEL[profile.role] : ''}</div>
            </div>
            <button className="icon-btn" aria-label="Sign out" onClick={() => supabase.auth.signOut()}><LogOut size={18} /></button>
          </div>
        </div>
      </aside>

      <div className="main">
        {!online && <div className="offline-bar">Offline · showing last loaded data · changes disabled</div>}
        <header className="topbar">
          <div className="brand">LabSync <b>■</b> {lab?.name}</div>
          <div style={{ flex: 1 }} className="only-desktop" />
          <button className="icon-btn" aria-label="Scan or look up (Ctrl+K)" onClick={() => open({ kind: 'scan' })}><ScanLine size={21} /></button>
          <Bell_ />
        </header>

        <main className="page" id="main">
          <Outlet />
        </main>
      </div>

      <button className="fab" onClick={() => open({ kind: 'quick' })} aria-label="Record something"><Plus size={20} strokeWidth={2.5} /> Record</button>

      <nav className="tabbar" aria-label="Main">
        {[NAV[0]!, NAV[1]!, NAV[2]!, NAV[4]!].map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            <n.icon size={22} strokeWidth={1.75} />
            <span>{n.label === 'Blood bank' ? 'Blood' : n.label === 'Inventory' ? 'Stock' : n.label}</span>
            {n.to === '/' && critical > 0 && <span className="dot" />}
          </NavLink>
        ))}
        <button className={`tab ${['/equipment', '/settings'].some((p) => loc.pathname.startsWith(p)) ? 'active' : ''}`} onClick={() => setMore(true)}>
          <MoreHorizontal size={22} strokeWidth={1.75} /><span>More</span>
        </button>
      </nav>

      <Sheet open={more} onClose={() => setMore(false)} title="More">
        <div className="quick-grid" style={{ margin: '-20px -20px 0' }}>
          <button className="quick" onClick={() => nav('/equipment')}><Wrench /><span className="q-t">Equipment & cold chain</span></button>
          <button className="quick" onClick={() => nav('/settings')}><Cog /><span className="q-t">Settings</span></button>
          <button className="quick" onClick={() => supabase.auth.signOut()}><LogOut /><span className="q-t">Sign out</span><span className="small muted">{profile?.email}</span></button>
        </div>
      </Sheet>

      <QuickSheets />
    </div>
  )
}
