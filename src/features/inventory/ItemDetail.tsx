import { useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, MoreVertical } from 'lucide-react'
import { supabase, q, friendlyError } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { useActions } from '../../lib/actions'
import { useToast } from '../../lib/toast'
import { useCategories, useLocations, usePeopleMap, useSuppliers } from '../../lib/data'
import type { Item, Lot, Movement, Task } from '../../lib/types'
import { AdjustSheet, ItemSheet, fefoLot, useInventory, useLots } from './sheets'
import { Empty, ErrorNote, Expiry, IdChip, Mark, Meter, PageHead, Section, Sheet, SkeletonRows, Tag } from '../../components/ui'
import { fmtDate, fmtDateTime, num, relTime, STOCK_STATUS, todayISO, PRIORITY, TASK_STATUS } from '../../lib/format'

export default function ItemDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { lab, can } = useSession()
  const { open } = useActions()
  const toast = useToast()
  const qc = useQueryClient()
  const warn = lab?.expiry_warning_days ?? 30
  const { data: inv = [] } = useInventory()
  const row = inv.find((i) => i.id === id)
  const { data: item, error, refetch } = useQuery({ queryKey: ['inventory', 'item', id], queryFn: () => q<Item>(supabase.from('items').select('*').eq('id', id!).single()) })
  const { data: lots } = useLots(id)
  const { data: moves } = useQuery({
    queryKey: ['inventory', 'moves', id],
    queryFn: () => q<(Movement & { stock_lots: { lot_number: string | null } })[]>(supabase.from('stock_movements').select('*, stock_lots(lot_number)').eq('item_id', id!).order('created_at', { ascending: false }).limit(40)),
  })
  const { data: tasks } = useQuery({
    queryKey: ['tasks', 'linked-item', id],
    queryFn: () => q<Task[]>(supabase.from('tasks').select('*').eq('linked_item_id', id!).neq('status', 'cancelled').order('created_at', { ascending: false }).limit(10)),
  })
  const people = usePeopleMap()
  const { data: cats = [] } = useCategories()
  const { data: locs = [] } = useLocations()
  const { data: sups = [] } = useSuppliers()
  const [edit, setEdit] = useState(false)
  const [adj, setAdj] = useState<{ lot: Lot; mode: 'adjust' | 'discard' } | null>(null)
  const [lotMenu, setLotMenu] = useState<Lot | null>(null)
  const [pickFor, setPickFor] = useState<'adjust' | 'discard' | null>(null)

  if (error) return <ErrorNote error={error} retry={refetch} />
  if (!item) return <SkeletonRows n={6} />

  const onHand = row?.on_hand ?? 0
  const first = fefoLot(lots)
  const status = row ? STOCK_STATUS[row.stock_status] : null
  const activeLots = lots?.filter((l) => l.quantity > 0) ?? []

  const lotUpdate = async (lot: Lot, patch: Partial<Lot>, msg: string) => {
    try {
      await q(supabase.from('stock_lots').update(patch).eq('id', lot.id))
      qc.invalidateQueries({ queryKey: ['inventory'] }); toast(msg); setLotMenu(null)
    } catch (e) { toast(friendlyError(e), { tone: 'error' }) }
  }
  const archive = async () => {
    if (!confirm(`Archive ${item.name}? It will be hidden from lists. History is kept.`)) return
    try { await q(supabase.from('items').update({ archived: true }).eq('id', item.id)); qc.invalidateQueries({ queryKey: ['inventory'] }); toast('Item archived'); nav('/inventory') }
    catch (e) { toast(friendlyError(e), { tone: 'error' }) }
  }
  const startLotAction = (mode: 'adjust' | 'discard') => {
    if (activeLots.length === 1) setAdj({ lot: activeLots[0]!, mode })
    else setPickFor(mode)
  }
  const MOVE: Record<string, string> = { receive: 'Received', consume: 'Used', adjust: 'Adjusted', discard: 'Discarded', return: 'Returned', transfer: 'Moved' }

  return (
    <>
      <PageHead crumb={<Link to="/inventory" className="crumb"><ChevronLeft size={14} /> Inventory</Link>}
        kicker={[cats.find((c) => c.id === item.category_id)?.name, item.sku].filter(Boolean).join(' · ') || 'Item'}
        title={item.name}
        actions={can('inventory.write') ? <><button className="btn sm" onClick={() => setEdit(true)}>Edit</button><button className="btn sm ghost" onClick={archive}>Archive</button></> : undefined} />

      <div className="hero">
        <div>
          <div className="label">On hand</div>
          <div className="big-num" style={{ fontSize: '3.4rem' }}>{num(onHand)}<span className="faint" style={{ fontSize: '1.2rem', marginLeft: 6 }}>{item.unit}</span></div>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <div className="hstack">{status && <><Mark tone={status.tone} /><b>{status.label}</b></>}<span className="muted small">· par {num(item.par_level)}{item.reorder_qty ? ` · reorder ${num(item.reorder_qty)}` : ''}</span></div>
          <Meter value={onHand} par={item.par_level} />
        </div>
      </div>

      <div className="action-bar" style={{ marginBottom: 28 }}>
        {can('stock.consume') && <button className="btn primary xl" disabled={!first} onClick={() => open({ kind: 'use', itemId: item.id })}>Use</button>}
        {can('inventory.write') && <button className="btn xl" onClick={() => open({ kind: 'receive', itemId: item.id })}>Receive</button>}
        {can('inventory.write') && <button className="btn xl" disabled={!activeLots.length} onClick={() => startLotAction('adjust')}>Adjust</button>}
        {can('inventory.write') && <button className="btn xl" disabled={!activeLots.length} onClick={() => startLotAction('discard')}>Discard</button>}
      </div>

      <div className="grid-2">
        <div>
          <Section title="Lots · first expiry first out" count={activeLots.length}>
            {!lots ? <SkeletonRows n={2} /> : activeLots.length === 0 ? <Empty text="No stock on hand." action={can('inventory.write') && <button className="btn sm" onClick={() => open({ kind: 'receive', itemId: item.id })}>Receive stock</button>} /> : (
              <ul className="ledger">
                {activeLots.map((l) => {
                  const expired = l.effective_expiry != null && l.effective_expiry < todayISO()
                  return (
                    <li key={l.id} className="row" style={{ gridTemplateColumns: '20px minmax(0,1fr) auto' }}>
                      <Mark tone={expired || l.is_damaged ? 'critical' : first?.id === l.id ? 'ok' : 'neutral'} />
                      <span style={{ minWidth: 0 }}>
                        <span className="hstack"><span className="mono" style={{ fontWeight: 600 }}>{l.lot_number || 'No lot no.'}</span>
                          {first?.id === l.id && <Tag tone="ok">Use first</Tag>}{l.opened_at && <Tag>Opened {fmtDate(l.opened_at)}</Tag>}{l.is_damaged && <Tag tone="critical">Damaged</Tag>}</span>
                        <span className="sub-line" style={{ display: 'block' }}>{locs.find((x) => x.id === l.location_id)?.name ?? '—'} · received {fmtDate(l.received_date)}{l.opened_at && item.open_stability_days ? ` · open stability ${item.open_stability_days}d` : ''}</span>
                      </span>
                      <span className="end">
                        <span className="mono">{num(l.quantity)}</span>
                        <Expiry date={l.effective_expiry} warnDays={warn} />
                        {can('inventory.write') && <button className="icon-btn" aria-label={`Lot ${l.lot_number} actions`} onClick={() => setLotMenu(l)}><MoreVertical size={18} /></button>}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Section>

          <Section title="Movement history">
            {!moves ? <SkeletonRows n={3} /> : moves.length === 0 ? <Empty text="No movements yet." /> : (
              <ul className="ledger">
                {moves.map((m) => (
                  <li key={m.id} className="row no-mark">
                    <span style={{ minWidth: 0 }}>
                      <span className="main-line" style={{ display: 'block' }}><b>{MOVE[m.type]}</b>{m.stock_lots?.lot_number ? <span className="mono faint small"> · {m.stock_lots.lot_number}</span> : null}</span>
                      <span className="sub-line" style={{ display: 'block' }}>{people.get(m.performed_by ?? '')?.full_name ?? '—'} · <span title={fmtDateTime(m.created_at)}>{relTime(m.created_at)}</span>{m.reason ? ` · ${m.reason}` : ''}</span>
                    </span>
                    <span className={`end mono ${m.quantity_delta > 0 ? 'c-green' : ''}`}>{m.quantity_delta > 0 ? '+' : ''}{num(m.quantity_delta)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div>
          <Section title="Details">
            <dl className="spec">
              <dt>Item code</dt><dd><IdChip value={item.sku} /></dd>
              <dt>Barcode</dt><dd><IdChip value={item.barcode} /></dd>
              <dt>Category</dt><dd>{cats.find((c) => c.id === item.category_id)?.name ?? '—'}</dd>
              <dt>Counted in</dt><dd>{item.unit}</dd>
              <dt>Usual location</dt><dd>{locs.find((c) => c.id === item.default_location_id)?.name ?? '—'}</dd>
              <dt>Supplier</dt><dd>{sups.find((c) => c.id === item.supplier_id)?.name ?? '—'}</dd>
              <dt>Manufacturer</dt><dd>{item.manufacturer ?? '—'}</dd>
              <dt>Open stability</dt><dd>{item.open_stability_days ? `${item.open_stability_days} days after opening` : '—'}</dd>
              <dt>Unit cost</dt><dd className="mono">{item.unit_cost != null ? `₦${num(item.unit_cost)}` : '—'}</dd>
              <dt>Stock value</dt><dd className="mono">{item.unit_cost != null ? `₦${num(item.unit_cost * onHand)}` : '—'}</dd>
              {item.notes && <><dt>Notes</dt><dd>{item.notes}</dd></>}
            </dl>
          </Section>
          <Section title="Linked tasks" action={<button className="linkish" onClick={() => open({ kind: 'task', preset: { linked_item_id: item.id, title: `Reorder ${item.name}` } })}>+ Task</button>}>
            {!tasks?.length ? <p className="muted small" style={{ padding: '12px 0' }}>No tasks linked to this item.</p> : (
              <ul className="ledger">{tasks.map((t) => (
                <li key={t.id}><Link to={`/tasks/${t.id}`} className="row">
                  <Mark tone={TASK_STATUS[t.status].tone} /><span className="main-line">{t.title}</span>
                  <span className="end"><Tag tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Tag></span>
                </Link></li>))}</ul>
            )}
          </Section>
        </div>
      </div>

      {edit && <ItemSheet itemId={item.id} onClose={() => setEdit(false)} />}
      {adj && <AdjustSheet item={item} lot={adj.lot} mode={adj.mode} onClose={() => setAdj(null)} />}
      {pickFor && (
        <Sheet open onClose={() => setPickFor(null)} title={pickFor === 'adjust' ? 'Adjust which lot?' : 'Discard from which lot?'}>
          <ul className="ledger">{activeLots.map((l) => (
            <li key={l.id}><button className="row" onClick={() => { setAdj({ lot: l, mode: pickFor }); setPickFor(null) }}>
              <Mark tone="neutral" /><span className="mono">{l.lot_number || 'No lot no.'}</span>
              <span className="end"><span className="mono">{num(l.quantity)}</span><Expiry date={l.effective_expiry} warnDays={warn} /></span>
            </button></li>))}</ul>
        </Sheet>
      )}
      {lotMenu && (
        <Sheet open onClose={() => setLotMenu(null)} title={`Lot ${lotMenu.lot_number || ''}`}>
          <div className="stack">
            <button className="btn block" onClick={() => { open({ kind: 'use', itemId: item.id, lotId: lotMenu.id }); setLotMenu(null) }}>Use from this lot</button>
            {!lotMenu.opened_at
              ? <button className="btn block" onClick={() => lotUpdate(lotMenu, { opened_at: todayISO() }, 'Marked opened today')}>Mark opened today</button>
              : <button className="btn block" onClick={() => lotUpdate(lotMenu, { opened_at: null }, 'Opened date cleared')}>Clear opened date</button>}
            <button className="btn block" onClick={() => lotUpdate(lotMenu, { is_damaged: !lotMenu.is_damaged }, lotMenu.is_damaged ? 'Damage flag removed' : 'Lot flagged as damaged')}>{lotMenu.is_damaged ? 'Remove damaged flag' : 'Flag as damaged'}</button>
            <button className="btn block" onClick={() => { setAdj({ lot: lotMenu, mode: 'adjust' }); setLotMenu(null) }}>Adjust count</button>
            <button className="btn block danger" onClick={() => { setAdj({ lot: lotMenu, mode: 'discard' }); setLotMenu(null) }}>Discard</button>
          </div>
        </Sheet>
      )}
    </>
  )
}
