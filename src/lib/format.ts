import type { Abo, BloodStatus, Component, EquipStatus, Priority, Rh, Role, TaskStatus, Tone } from './types'

let TZ = 'Africa/Lagos'
export const setTimezone = (tz: string) => { TZ = tz || TZ }

/** "14 Nov 2026" in the lab's timezone */
export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' && d.length === 10 ? new Date(d + 'T12:00:00Z') : new Date(d)
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ }).format(date)
}
export function fmtShort(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' && d.length === 10 ? new Date(d + 'T12:00:00Z') : new Date(d)
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: TZ }).format(date)
}
export function fmtTime(d: string | Date | null | undefined): string {
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(new Date(d))
}
export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return '—'
  return `${fmtShort(d)} · ${fmtTime(d)}`
}
/** Today's date (YYYY-MM-DD) in the lab timezone */
export function todayISO(): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return p
}
export function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10)
}
/** Whole days from today to a date (negative = past) */
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null
  const a = new Date(todayISO() + 'T12:00:00Z').getTime()
  const b = new Date(iso.slice(0, 10) + 'T12:00:00Z').getTime()
  return Math.round((b - a) / 86400000)
}
export function relTime(d: string | null | undefined): string {
  if (!d) return ''
  const s = (Date.now() - new Date(d).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`
  return fmtShort(d)
}
export function greeting(): string {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: TZ }).format(new Date()))
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}
export function initials(name: string | null | undefined): string {
  if (!name) return '··'
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')
}
export function firstName(name: string | null | undefined): string {
  return (name ?? '').split(/\s+/)[0] || 'there'
}
export const num = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(n)

// ---------- domain labels ----------
export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Director / Admin', supervisor: 'Supervisor', inventory_officer: 'Inventory officer', staff: 'Staff',
}
export const COMPONENTS: Component[] = ['packed_red_cells', 'whole_blood', 'fresh_frozen_plasma', 'platelets', 'cryoprecipitate']
export const COMPONENT_LABEL: Record<Component, string> = {
  whole_blood: 'Whole blood', packed_red_cells: 'Packed red cells', fresh_frozen_plasma: 'Fresh frozen plasma',
  platelets: 'Platelets', cryoprecipitate: 'Cryoprecipitate',
}
export const COMPONENT_SHORT: Record<Component, string> = {
  whole_blood: 'WB', packed_red_cells: 'PRC', fresh_frozen_plasma: 'FFP', platelets: 'PLT', cryoprecipitate: 'CRYO',
}
export const GROUPS: { abo: Abo; rh: Rh }[] = [
  { abo: 'O', rh: 'neg' }, { abo: 'O', rh: 'pos' }, { abo: 'A', rh: 'neg' }, { abo: 'A', rh: 'pos' },
  { abo: 'B', rh: 'neg' }, { abo: 'B', rh: 'pos' }, { abo: 'AB', rh: 'neg' }, { abo: 'AB', rh: 'pos' },
]
export const groupLabel = (abo: Abo, rh: Rh) => `${abo}${rh === 'pos' ? '+' : '−'}`

export const BLOOD_STATUS: Record<BloodStatus, { label: string; tone: Tone }> = {
  quarantine: { label: 'Quarantine', tone: 'info' },
  available: { label: 'Available', tone: 'ok' },
  reserved: { label: 'Reserved', tone: 'warning' },
  issued: { label: 'Issued', tone: 'neutral' },
  discarded: { label: 'Discarded', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'critical' },
}
export const TASK_STATUS: Record<TaskStatus, { label: string; tone: Tone }> = {
  pending: { label: 'To do', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'info' },
  completed: { label: 'Done', tone: 'ok' },
  delayed: { label: 'Overdue', tone: 'critical' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}
export const PRIORITY: Record<Priority, { label: string; tone: Tone }> = {
  low: { label: 'Low', tone: 'neutral' }, medium: { label: 'Medium', tone: 'info' },
  high: { label: 'High', tone: 'warning' }, critical: { label: 'Critical', tone: 'critical' },
}
export const EQUIP_STATUS: Record<EquipStatus, { label: string; tone: Tone }> = {
  operational: { label: 'Operational', tone: 'ok' },
  due_service: { label: 'Due service', tone: 'warning' },
  under_maintenance: { label: 'Under maintenance', tone: 'info' },
  out_of_service: { label: 'Out of service', tone: 'critical' },
  retired: { label: 'Retired', tone: 'neutral' },
}
export const STOCK_STATUS = {
  expired: { label: 'Expired stock', tone: 'critical' as Tone },
  out_of_stock: { label: 'Out of stock', tone: 'critical' as Tone },
  low_stock: { label: 'Below par', tone: 'warning' as Tone },
  ok: { label: 'In stock', tone: 'ok' as Tone },
}
