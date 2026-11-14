import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, ScanLine } from 'lucide-react'
import { supabase, q, friendlyError } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { useToast } from '../../lib/toast'
import { useActions } from '../../lib/actions'
import { useCategories, useLocations, useSuppliers } from '../../lib/data'
import type { InventoryRow, Item, Lot } from '../../lib/types'
import { Expiry, Field, Mark, Sheet, Stepper, Tag, Chips } from '../../components/ui'
import { fmtDate, num, todayISO, STOCK_STATUS } from '../../lib/format'

export function useInventory() {
  return useQuery({
    queryKey: ['inventory', 'overview'],
    queryFn: () => q<InventoryRow[]>(supabase.from('inventory_overview').select('*').eq('archived', false).order('name')),
  })
}
export function useLots(itemId: string | undefined) {
  return useQuery({
    queryKey: ['inventory', 'lots', itemId],
    enabled: !!itemId,
    queryFn: () => q<Lot[]>(supabase.from('lot_overview').select('*').eq('item_id', itemId!)
      .order('effective_expiry', { ascending: true, nullsFirst: false }).order('received_date')),
  })
}
/** First-expiry-first-out: the usable lot that should be used next */
export function fefoLot(lots: Lot[] | undefined): Lot | undefined {
  const today = todayISO()
  return lots?.find((l) => l.quantity > 0 && !l.is_damaged && (!l.effective_expiry || l.effective_expiry >= today))
}

function invalidateStock(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['inventory'] })
  qc.invalidateQueries({ queryKey: ['today'] })
}

/* ---------- item picker ---------- */
export function ItemPicker({ onPick, onlyInStock }: { onPick: (i: InventoryRow) => void; onlyInStock?: boolean }) {
  const { data = [], isLoading } = useInventory()
  const { open } = useActions()
  const [s, setS] = useState('')
  const list = useMemo(() => {
    const t = s.trim().toLowerCase()
    return data
      .filter((i) => !onlyInStock || i.on_hand > 0)
      .filter((i) => !t || i.name.toLowerCase().includes(t) || i.sku?.toLowerCase().includes(t) || i.barcode === t)
      .slice(0, 60)
  }, [data, s, onlyInStock])
  return (
    <div>
      <div className="toolbar">
        <div className="search">
          <Search size={18} />
          <input className="input" autoFocus placeholder="Search item, code or barcode" value={s} onChange={(e) => setS(e.target.value)} aria-label="Search items" />
        </div>
        <button className="btn" onClick={() => open({ kind: 'scan' })} aria-label="Scan barcode"><ScanLine size={18} /> Scan</button>
      </div>
      {isLoading && <p className="muted">Loading items…</p>}
      {!isLoading && list.length === 0 && <p className="muted" style={{ padding: '12px 0' }}>{data.length ? 'No match.' : 'No items yet. Add your first item in Inventory.'}</p>}
      <ul className="ledger">
        {list.map((i) => (
          <li key={i.id}>
            <button className="row" onClick={() => onPick(i)}>
              <Mark tone={STOCK_STATUS[i.stock_status].tone} title={STOCK_STATUS[i.stock_status].label} />
              <span style={{ minWidth: 0 }}>
                <span className="main-line" style={{ display: 'block' }}>{i.name}</span>
                <span className="sub-line" style={{ display: 'block' }}>{i.category_name ?? 'Uncategorised'}{i.location_name ? ` · ${i.location_name}` : ''}</span>
              </span>
              <span className="end mono">{num(i.on_hand)} <span className="faint small">{i.unit}</span></span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function LotChoice({ lots, value, onChange, warn }: { lots: Lot[]; value: string; onChange: (id: string) => void; warn: number }) {
  const first = fefoLot(lots)
  const usable = lots.filter((l) => l.quantity > 0)
  if (!usable.length) return <p className="banner warning"><span className="b-body">No stock in any lot. Receive stock first.</span></p>
  return (
    <div className="stack" style={{ gap: 6 }}>
      {usable.map((l) => (
        <button key={l.id} type="button" className={`choice ${value === l.id ? 'on' : ''}`} onClick={() => onChange(l.id)}>
          <div className="spread">
            <span className="mono" style={{ fontWeight: 600 }}>{l.lot_number || 'No lot no.'}</span>
            <span className="hstack">
              {first?.id === l.id && <Tag tone="ok">Use first</Tag>}
              {l.opened_at && <Tag>Opened</Tag>}
              {l.is_damaged && <Tag tone="critical">Damaged</Tag>}
              <Expiry date={l.effective_expiry} warnDays={warn} />
            </span>
          </div>
          <div className="small muted mono" style={{ marginTop: 4 }}>{num(l.quantity)} left · received {fmtDate(l.received_date)}</div>
        </button>
      ))}
    </div>
  )
}

/* ---------- use stock: the fastest path in the app ---------- */
export function UseStockSheet({ itemId: initial, lotId, onClose }: { itemId?: string; lotId?: string; onClose: () => void }) {
  const { lab } = useSession()
  const toast = useToast()
  const qc = useQueryClient()
  const { data: inv = [] } = useInventory()
  const [itemId, setItemId] = useState(initial)
  const item = inv.find((i) => i.id === itemId)
  const { data: lots } = useLots(itemId)
  const [lot, setLot] = useState(lotId ?? '')
  const [qty, setQty] = useState(1)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (lots && !lot) setLot(fefoLot(lots)?.id ?? lots.find((l) => l.quantity > 0)?.id ?? '') }, [lots, lot])
  const chosen = lots?.find((l) => l.id === lot)

  const save = async () => {
    if (!item || !chosen || qty <= 0) return
    setBusy(true)
    try {
      const { data, error } = await supabase.from('stock_movements')
        .insert({ item_id: item.id, lot_id: chosen.id, type: 'consume', quantity_delta: -qty, reason: reason || null }).select('id').single()
      if (error) throw error
      invalidateStock(qc)
      onClose()
      toast(`Used ${num(qty)} ${item.unit} · ${item.name}`, {
        undo: async () => {
          const r = await supabase.from('stock_movements').insert({ item_id: item.id, lot_id: chosen.id, type: 'return', quantity_delta: qty, reason: `Undo of ${data.id.slice(0, 8)}` })
          if (r.error) toast(friendlyError(r.error), { tone: 'error' }); else { invalidateStock(qc); toast('Usage undone') }
        },
      })
    } catch (e) {
      toast(friendlyError(e), { tone: 'error' })
    } finally { setBusy(false) }
  }

  return (
    <Sheet open onClose={onClose} title={item ? `Use · ${item.name}` : 'Use stock'}
      footer={item ? <>
        <button className="btn" onClick={() => (initial ? onClose() : setItemId(undefined))}>{initial ? 'Cancel' : 'Back'}</button>
        <button className="btn primary xl" disabled={busy || !chosen || qty <= 0 || qty > (chosen?.quantity ?? 0)} onClick={save}>
          {busy ? 'Saving…' : `Use ${num(qty)} ${item.unit}`}
        </button>
      </> : undefined}>
      {!item ? (
        <ItemPicker onlyInStock onPick={(i) => { setItemId(i.id); setLot('') }} />
      ) : (
        <>
          <Field label="Quantity">
            <Stepper value={qty} onChange={setQty} min={0} label="Quantity" />
          </Field>
          {chosen && qty > chosen.quantity && <p className="err small" style={{ marginTop: -8, marginBottom: 12, color: 'var(--red)' }}>Only {num(chosen.quantity)} left in this lot.</p>}
          <Field label="From lot">
            {lots ? <LotChoice lots={lots} value={lot} onChange={setLot} warn={lab?.expiry_warning_days ?? 30} /> : <p className="muted">Loading lots…</p>}
          </Field>
          <Field label="Reason (optional)">
            <Chips value={reason} onChange={setReason} options={[
              { value: '', label: 'Routine test' }, { value: 'QC run', label: 'QC run' }, { value: 'Calibration', label: 'Calibration' },
              { value: 'Repeat test', label: 'Repeat test' }, { value: 'Training', label: 'Training' },
            ]} />
          </Field>
        </>
      )}
    </Sheet>
  )
}

/* ---------- receive stock ---------- */
export function ReceiveSheet({ itemId: initial, onClose }: { itemId?: string; onClose: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const { data: inv = [] } = useInventory()
  const { data: locations = [] } = useLocations()
  const { data: suppliers = [] } = useSuppliers()
  const [itemId, setItemId] = useState(initial)
  const item = inv.find((i) => i.id === itemId)
  const [f, setF] = useState({ lot_number: '', expiry_date: '', qty: 1, location_id: '', supplier_id: '' })
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (item) setF((x) => ({ ...x, location_id: x.location_id || item.default_location_id || '', supplier_id: x.supplier_id || item.supplier_id || '' })) }, [item])

  const save = async () => {
    if (!item || f.qty <= 0) return
    if (item.track_expiry && !f.expiry_date) { toast('Enter the expiry date printed on the pack', { tone: 'error' }); return }
    setBusy(true)
    try {
      let lotId: string | undefined
      if (f.lot_number) {
        const ex = await q<{ id: string }[]>(supabase.from('stock_lots').select('id').eq('item_id', item.id).eq('lot_number', f.lot_number).limit(1))
        lotId = ex[0]?.id
      }
      if (!lotId) {
        const lot = await q<{ id: string }>(supabase.from('stock_lots').insert({
          item_id: item.id, lot_number: f.lot_number || null, expiry_date: f.expiry_date || null,
          location_id: f.location_id || null, supplier_id: f.supplier_id || null,
        }).select('id').single())
        lotId = lot.id
      }
      await q(supabase.from('stock_movements').insert({ item_id: item.id, lot_id: lotId, type: 'receive', quantity_delta: f.qty, reason: 'Received' }))
      invalidateStock(qc)
      toast(`Received ${num(f.qty)} ${item.unit} · ${item.name}`)
      onClose()
    } catch (e) { toast(friendlyError(e), { tone: 'error' }) } finally { setBusy(false) }
  }

  return (
    <Sheet open onClose={onClose} title={item ? `Receive · ${item.name}` : 'Receive stock'}
      footer={item ? <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || f.qty <= 0} onClick={save}>{busy ? 'Saving…' : 'Receive'}</button>
      </> : undefined}>
      {!item ? <ItemPicker onPick={(i) => setItemId(i.id)} /> : (
        <>
          <Field label="Quantity received" hint={`In ${item.unit}`}><Stepper value={f.qty} onChange={(qty) => setF({ ...f, qty })} min={0} label="Quantity" /></Field>
          <div className="row-fields">
            <Field label="Lot / batch no." htmlFor="lotno" hint="Same lot? It's added to it"><input id="lotno" className="input mono" value={f.lot_number} onChange={(e) => setF({ ...f, lot_number: e.target.value })} /></Field>
            <Field label={item.track_expiry ? 'Expiry date *' : 'Expiry date'} htmlFor="exp"><input id="exp" type="date" className="input" value={f.expiry_date} onChange={(e) => setF({ ...f, expiry_date: e.target.value })} /></Field>
          </div>
          <Field label="Store in" htmlFor="loc">
            <select id="loc" className="select" value={f.location_id} onChange={(e) => setF({ ...f, location_id: e.target.value })}>
              <option value="">—</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Supplier" htmlFor="sup">
            <select id="sup" className="select" value={f.supplier_id} onChange={(e) => setF({ ...f, supplier_id: e.target.value })}>
              <option value="">—</option>{suppliers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
        </>
      )}
    </Sheet>
  )
}

/* ---------- adjust count / discard ---------- */
export function AdjustSheet({ item, lot, mode, onClose }: { item: InventoryRow | Item; lot: Lot; mode: 'adjust' | 'discard'; onClose: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [count, setCount] = useState(lot.quantity)
  const [qty, setQty] = useState(1)
  const [reason, setReason] = useState(mode === 'discard' ? 'Expired' : 'Count correction')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const delta = mode === 'adjust' ? +(count - lot.quantity).toFixed(3) : -qty
  const reasons = mode === 'discard' ? ['Expired', 'Damaged', 'Contaminated', 'Other'] : ['Count correction', 'Found stock', 'Data entry error', 'Other']

  const save = async () => {
    if (delta === 0) return onClose()
    if (reason === 'Other' && !note.trim()) { toast('Add a note explaining the reason', { tone: 'error' }); return }
    setBusy(true)
    try {
      await q(supabase.from('stock_movements').insert({ item_id: item.id, lot_id: lot.id, type: mode, quantity_delta: delta, reason: [reason, note].filter(Boolean).join(' — ') }))
      invalidateStock(qc)
      toast(mode === 'discard' ? `Discarded ${num(qty)} ${item.unit}` : `Count set to ${num(count)} ${item.unit}`)
      onClose()
    } catch (e) { toast(friendlyError(e), { tone: 'error' }) } finally { setBusy(false) }
  }
  return (
    <Sheet open onClose={onClose} title={`${mode === 'discard' ? 'Discard' : 'Adjust count'} · ${lot.lot_number || 'lot'}`}
      footer={<><button className="btn" onClick={onClose}>Cancel</button>
        <button className={`btn ${mode === 'discard' ? 'danger' : 'primary'}`} disabled={busy || delta === 0 || (mode === 'discard' && qty > lot.quantity)} onClick={save}>{busy ? 'Saving…' : mode === 'discard' ? `Discard ${num(qty)}` : 'Save count'}</button></>}>
      <p className="muted small" style={{ marginBottom: 16 }}>{item.name} · currently <span className="mono">{num(lot.quantity)} {item.unit}</span> in this lot.</p>
      {mode === 'adjust'
        ? <Field label="Counted on the shelf" hint={delta === 0 ? 'No change' : `Change: ${delta > 0 ? '+' : ''}${num(delta)}`}><Stepper value={count} onChange={setCount} label="Counted quantity" /></Field>
        : <Field label="Quantity to discard"><Stepper value={qty} onChange={setQty} min={0} label="Discard quantity" /></Field>}
      <Field label="Reason"><Chips value={reason} onChange={setReason} options={reasons.map((r) => ({ value: r, label: r }))} /></Field>
      <Field label={reason === 'Other' ? 'Note *' : 'Note'} htmlFor="note"><textarea id="note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Sheet>
  )
}

/* ---------- create / edit item ---------- */
const UNITS = ['pcs', 'box', 'pack', 'kit', 'bottle', 'vial', 'mL', 'L', 'g', 'kg', 'test', 'roll', 'pair']
export function ItemSheet({ itemId, barcode, onClose, onSaved }: { itemId?: string; barcode?: string; onClose: () => void; onSaved?: (id: string) => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const { data: cats = [] } = useCategories()
  const { data: locations = [] } = useLocations()
  const { data: suppliers = [] } = useSuppliers()
  const { data: existing } = useQuery({
    queryKey: ['inventory', 'item', itemId], enabled: !!itemId,
    queryFn: () => q<Item>(supabase.from('items').select('*').eq('id', itemId!).single()),
  })
  const blank = { name: '', sku: '', barcode: barcode ?? '', category_id: '', unit: 'pcs', par_level: 0, reorder_qty: '', default_location_id: '', supplier_id: '', manufacturer: '', track_expiry: true, open_stability_days: '', unit_cost: '', notes: '' }
  const [f, setF] = useState<Record<string, string | number | boolean>>(blank)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (existing) setF(Object.fromEntries(Object.entries(blank).map(([k, v]) => [k, (existing as unknown as Record<string, unknown>)[k] ?? (typeof v === 'boolean' ? v : '')])) as Record<string, string | number | boolean>)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing])
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const n = (v: unknown) => (v === '' || v == null ? null : Number(v))
  const s = (v: unknown) => (v === '' || v == null ? null : String(v).trim())

  const save = async () => {
    if (!String(f.name).trim()) { toast('Give the item a name', { tone: 'error' }); return }
    setBusy(true)
    const row = {
      name: String(f.name).trim(), sku: s(f.sku), barcode: s(f.barcode), category_id: s(f.category_id), unit: String(f.unit || 'pcs'),
      par_level: n(f.par_level) ?? 0, reorder_qty: n(f.reorder_qty), default_location_id: s(f.default_location_id), supplier_id: s(f.supplier_id),
      manufacturer: s(f.manufacturer), track_expiry: !!f.track_expiry, open_stability_days: n(f.open_stability_days), unit_cost: n(f.unit_cost), notes: s(f.notes),
    }
    try {
      const res = itemId
        ? await q<{ id: string }>(supabase.from('items').update(row).eq('id', itemId).select('id').single())
        : await q<{ id: string }>(supabase.from('items').insert(row).select('id').single())
      qc.invalidateQueries({ queryKey: ['inventory'] })
      toast(itemId ? 'Item updated' : 'Item added')
      onSaved?.(res.id); onClose()
    } catch (e) { toast(friendlyError(e), { tone: 'error' }) } finally { setBusy(false) }
  }

  return (
    <Sheet open onClose={onClose} title={itemId ? 'Edit item' : 'New item'}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save item'}</button></>}>
      <fieldset className="fieldset"><legend className="label">Basics</legend>
        <Field label="Name *" htmlFor="i-name"><input id="i-name" className="input" value={String(f.name)} onChange={set('name')} placeholder="e.g. Full blood count reagent pack" /></Field>
        <div className="row-fields">
          <Field label="Category" htmlFor="i-cat"><select id="i-cat" className="select" value={String(f.category_id)} onChange={set('category_id')}><option value="">—</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Counted in" htmlFor="i-unit"><select id="i-unit" className="select" value={String(f.unit)} onChange={set('unit')}>{[...new Set([...UNITS, String(f.unit)])].map((u) => <option key={u}>{u}</option>)}</select></Field>
        </div>
        <div className="row-fields">
          <Field label="Par level" htmlFor="i-par" hint="Alert at or below this"><input id="i-par" className="input mono" inputMode="decimal" value={String(f.par_level)} onChange={set('par_level')} /></Field>
          <Field label="Reorder qty" htmlFor="i-ro"><input id="i-ro" className="input mono" inputMode="decimal" value={String(f.reorder_qty)} onChange={set('reorder_qty')} /></Field>
        </div>
      </fieldset>
      <fieldset className="fieldset"><legend className="label">Identification</legend>
        <div className="row-fields">
          <Field label="Item code" htmlFor="i-sku"><input id="i-sku" className="input mono" value={String(f.sku)} onChange={set('sku')} /></Field>
          <Field label="Barcode" htmlFor="i-bc"><input id="i-bc" className="input mono" value={String(f.barcode)} onChange={set('barcode')} /></Field>
        </div>
        <Field label="Manufacturer" htmlFor="i-man"><input id="i-man" className="input" value={String(f.manufacturer)} onChange={set('manufacturer')} /></Field>
      </fieldset>
      <fieldset className="fieldset"><legend className="label">Storage & supply</legend>
        <Field label="Usual location" htmlFor="i-loc"><select id="i-loc" className="select" value={String(f.default_location_id)} onChange={set('default_location_id')}><option value="">—</option>{locations.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Supplier" htmlFor="i-sup"><select id="i-sup" className="select" value={String(f.supplier_id)} onChange={set('supplier_id')}><option value="">—</option>{suppliers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <div className="row-fields">
          <Field label="Stable after opening" htmlFor="i-os" hint="Days. Leave empty if n/a"><input id="i-os" className="input mono" inputMode="numeric" value={String(f.open_stability_days)} onChange={set('open_stability_days')} /></Field>
          <Field label="Unit cost (₦)" htmlFor="i-cost"><input id="i-cost" className="input mono" inputMode="decimal" value={String(f.unit_cost)} onChange={set('unit_cost')} /></Field>
        </div>
        <label className="hstack" style={{ marginBottom: 16, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!f.track_expiry} onChange={(e) => setF({ ...f, track_expiry: e.target.checked })} style={{ width: 20, height: 20 }} />
          <span>Track expiry dates for this item</span>
        </label>
        <Field label="Notes" htmlFor="i-notes"><textarea id="i-notes" className="textarea" value={String(f.notes)} onChange={set('notes')} /></Field>
      </fieldset>
    </Sheet>
  )
}
