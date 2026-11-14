import { useEffect, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X, Minus, Plus, Check } from 'lucide-react'
import { daysUntil, fmtDate } from '../lib/format'
import type { Tone } from '../lib/types'
import { useToast } from '../lib/toast'

/* ---------- status mark: shape + colour ---------- */
export function Mark({ tone, title }: { tone: Tone; title?: string }) {
  return <span className={`mark ${tone}`} role="img" aria-label={title ?? tone} title={title} />
}

export function Tag({ tone = 'neutral', children, solid }: { tone?: Tone; children: ReactNode; solid?: boolean }) {
  return <span className={`tag ${solid ? (tone === 'critical' ? 'solid-red' : 'solid') : tone}`}>{children}</span>
}

/* ---------- expiry stamp ---------- */
export function expiryTone(iso: string | null | undefined, warnDays: number): Tone {
  const d = daysUntil(iso)
  if (d == null) return 'neutral'
  if (d < 0) return 'critical'
  if (d <= warnDays) return 'warning'
  return 'neutral'
}
export function Expiry({ date, warnDays = 30 }: { date: string | null | undefined; warnDays?: number }) {
  const d = daysUntil(date)
  if (d == null) return <span className="faint mono small">No expiry</span>
  const tone = expiryTone(date, warnDays)
  const text = d < 0 ? `Expired ${-d}d` : d === 0 ? 'Today' : d === 1 ? '1 day' : d > 365 ? `${Math.round(d / 30)} mo` : `${d}d`
  return <span className={`tag ${tone}`} title={fmtDate(date)}>{text}</span>
}

/* ---------- stock meter ---------- */
export function Meter({ value, par }: { value: number; par: number }) {
  const max = Math.max(par * 2, value, 1)
  const pct = Math.min(100, (value / max) * 100)
  const cls = value <= par ? 'low' : value <= par * 1.25 ? 'warn' : ''
  return (
    <div className={`meter ${cls}`} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={`${value} on hand, par ${par}`}>
      <i style={{ width: `${pct}%` }} />
      {par > 0 && <span className="par" style={{ left: `${(par / max) * 100}%` }} />}
    </div>
  )
}

/* ---------- copyable mono ID ---------- */
export function IdChip({ value }: { value: string | null | undefined }) {
  const toast = useToast()
  if (!value) return <span className="faint">—</span>
  return (
    <span className="id-chip" title="Copy" onClick={(e) => {
      e.preventDefault(); e.stopPropagation()
      navigator.clipboard?.writeText(value).then(() => toast(`Copied ${value}`))
    }}>{value}</span>
  )
}

/* ---------- section header ---------- */
export function Section({ title, action, children, count }: { title: string; action?: ReactNode; children: ReactNode; count?: number }) {
  return (
    <section className="section">
      <div className="sec-head">
        <span className="label">{title}{count != null && <span className="faint"> · {String(count).padStart(2, '0')}</span>}</span>
        {action}
      </div>
      {children}
    </section>
  )
}

export function PageHead({ kicker, title, actions, crumb }: { kicker?: string; title: ReactNode; actions?: ReactNode; crumb?: ReactNode }) {
  return (
    <>
      {crumb}
      <header className="page-head">
        <div>
          {kicker && <div className="label kicker">{kicker}</div>}
          <h1 className="title-xl">{title}</h1>
        </div>
        {actions && <div className="actions">{actions}</div>}
      </header>
    </>
  )
}

/* ---------- empty / loading ---------- */
export function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return <div className="empty"><p className="muted">{text}</p>{action}</div>
}
export function SkeletonRows({ n = 5 }: { n?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="skel-row">
          <div className="skel" style={{ width: 12, height: 12 }} />
          <div className="stack" style={{ gap: 6 }}>
            <div className="skel" style={{ width: `${50 + ((i * 17) % 40)}%` }} />
            <div className="skel" style={{ width: `${25 + ((i * 11) % 30)}%`, height: 10 }} />
          </div>
          <div className="skel" style={{ width: 60 }} />
        </div>
      ))}
    </div>
  )
}
export function ErrorNote({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="banner critical" role="alert">
      <div className="b-body">
        <div className="b-title">Couldn't load this</div>
        <p className="small">{(error as Error)?.message ?? 'Something went wrong.'}</p>
      </div>
      {retry && <button className="btn sm" onClick={retry}>Retry</button>}
    </div>
  )
}

/* ---------- sheet: bottom sheet on phone, drawer on desktop ---------- */
export function Sheet({ open, onClose, title, children, footer, wide }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean
}) {
  const id = useId()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <div className={`sheet ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="grabber" />
        <div className="sheet-head">
          <h2 className="title-m" id={id}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </>,
    document.body,
  )
}

/* ---------- form bits ---------- */
export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="err">{error}</span>}
    </div>
  )
}

export function Stepper({ value, onChange, min = 0, step = 1, label }: { value: number; onChange: (n: number) => void; min?: number; step?: number; label: string }) {
  return (
    <div className="stepper">
      <button type="button" aria-label={`Decrease ${label}`} onClick={() => onChange(Math.max(min, +(value - step).toFixed(3)))}><Minus /></button>
      <input aria-label={label} inputMode="decimal" value={Number.isFinite(value) ? value : ''} onChange={(e) => {
        const n = parseFloat(e.target.value.replace(',', '.'))
        onChange(Number.isFinite(n) ? n : 0)
      }} onFocus={(e) => e.target.select()} />
      <button type="button" aria-label={`Increase ${label}`} onClick={() => onChange(+(value + step).toFixed(3))}><Plus /></button>
    </div>
  )
}

export function Seg<T extends string>({ value, onChange, options, full }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; full?: boolean }) {
  return (
    <div className={`seg ${full ? 'full' : ''}`} role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button key={o.value} type="button" className={`chip ${value === o.value ? 'on' : ''}`} onClick={() => onChange(o.value)} aria-pressed={value === o.value}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function CheckBox({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" className={`check ${on ? 'on' : ''}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle() }} aria-pressed={on} aria-label={label}>
      {on && <Check size={16} strokeWidth={3} />}
    </button>
  )
}

export function Avatar({ name, lg }: { name: string | null | undefined; lg?: boolean }) {
  const ini = (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '··'
  return <span className={`avatar ${lg ? 'lg' : ''}`} aria-hidden>{ini}</span>
}
