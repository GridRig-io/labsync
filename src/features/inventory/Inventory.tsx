import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, Plus } from 'lucide-react'
import { supabase, q } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { useActions } from '../../lib/actions'
import { useCategories, usePeopleMap } from '../../lib/data'
import { useInventory } from './sheets'
import { Chips, Empty, ErrorNote, Expiry, Mark, Meter, PageHead, Seg, SkeletonRows, IdChip } from '../../components/ui'
import { daysUntil, fmtDateTime, num, STOCK_STATUS, relTime } from '../../lib/format'

type Filter = 'all' | 'low_stock' | 'out_of_stock' | 'expired' | 'expiring'

export default function Inventory() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as 'items' | 'lots' | 'moves') || 'items'
  const { can } = useSession()
  const { open } = useActions()
  return (
    <>
      <PageHead kicker="02 · Inventory" title="Stock register" actions={<>
        {can('stock.consume') && <button className="btn primary" onClick={() => open({ kind: 'use' })}>Use stock</button>}
        {can('inventory.write') && <button className="btn" onClick={() => open({ kind: 'receive' })}>Receive</button>}
        {can('inventory.write') && <button className="btn" onClick={() => open({ kind: 'item' })}><Plus size={16} /> Item</button>}
      </>} />
      <div style={{ marginBottom: 16 }}>
        <Seg value={tab} onChange={(t) => setParams(t === 'items' ? {} : { tab: t })} options={[
          { value: 'items', label: 'Items' }, { value: 'lots', label: 'Lots by expiry' }, { value: 'moves', label: 'Movements' }]} />
      </div>
      {tab === 'items' && <Items />}
      {tab === 'lots' && <Lots />}
      {tab === 'moves' && <Moves />}
    </>
  )
}

function Items() {
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const { lab, can } = useSession()
  const { open } = useActions()
  const warn = lab?.expiry_warning_days ?? 30
  const { data = [], isLoading, error, refetch } = useInventory()
  const { data: cats = [] } = useCategories()
  const [s, setS] = useState('')
  const [cat, setCat] = useState('')
  const [sort, setSort] = useState<'name' | 'on_hand' | 'expiry'>('name')
  const filter = (params.get('status') as Filter) || 'all'

  const list = useMemo(() => {
    const t = s.trim().toLowerCase()
    let l = data.filter((i) =>
      (!t || i.name.toLowerCase().includes(t) || i.sku?.toLowerCase().includes(t) || i.barcode?.includes(t)) &&
      (!cat || i.category_id === cat) &&
      (filter === 'all' ? true
        : filter === 'expiring' ? i.nearest_expiry != null && (daysUntil(i.nearest_expiry) ?? 999) <= warn
        : filter === 'out_of_stock' ? i.stock_status === 'out_of_stock'
        : i.stock_status === filter))
    l = [...l].sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name)
      : sort === 'on_hand' ? (a.on_hand / Math.max(a.par_level, 1)) - (b.on_hand / Math.max(b.par_level, 1))
      : (a.nearest_expiry ?? '9999').localeCompare(b.nearest_expiry ?? '9999'))
    return l
  }, [data, s, cat, filter, sort, warn])

  const count = (f: Filter) => f === 'all' ? data.length : f === 'expiring'
    ? data.filter((i) => i.nearest_expiry && (daysUntil(i.nearest_expiry) ?? 999) <= warn).length
    : data.filter((i) => i.stock_status === f).length

  if (error) return <ErrorNote error={error} retry={refetch} />
  return (
    <>
      <div className="toolbar">
        <div className="search"><Search size={18} /><input className="input" placeholder="Search name, code, barcode" value={s} onChange={(e) => setS(e.target.value)} aria-label="Search items" /></div>
        <select className="select" style={{ width: 'auto', minWidth: 160 }} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
          <option value="">All categories</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
          <option value="name">A–Z</option><option value="on_hand">Lowest stock first</option><option value="expiry">Soonest expiry</option>
        </select>
      </div>
      <div style={{ marginBottom: 12 }}>
        <Chips value={filter} onChange={(f) => setParams(f === 'all' ? {} : { status: f })} options={[
          { value: 'all', label: `All ${count('all')}` }, { value: 'low_stock', label: `Below par ${count('low_stock')}` },
          { value: 'out_of_stock', label: `Out ${count('out_of_stock')}` }, { value: 'expired', label: `Expired ${count('expired')}` },
          { value: 'expiring', label: `Expiring ${count('expiring')}` }]} />
      </div>

      {isLoading ? <SkeletonRows n={8} /> : list.length === 0 ? (
        data.length === 0
          ? <Empty text="No items yet. Add the first item in your store." action={can('inventory.write') && <button className="btn primary" onClick={() => open({ kind: 'item' })}>Add first item</button>} />
          : <Empty text="Nothing matches these filters." />
      ) : (
        <>
          <ul className="ledger only-mobile">
            {list.map((i) => (
              <li key={i.id}>
                <Link to={`/inventory/${i.id}`} className="row">
                  <Mark tone={STOCK_STATUS[i.stock_status].tone} title={STOCK_STATUS[i.stock_status].label} />
                  <span style={{ minWidth: 0 }}>
                    <span className="main-line" style={{ display: 'block' }}>{i.name}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                      <span style={{ flex: '0 0 72px' }}><Meter value={i.on_hand} par={i.par_level} /></span>
                      <span className="sub-line">{i.category_name ?? '—'}</span>
                    </span>
                  </span>
                  <span className="end" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span className="mono">{num(i.on_hand)}<span className="faint small"> / {num(i.par_level)} {i.unit}</span></span>
                    {i.track_expiry && i.on_hand > 0 && <Expiry date={i.nearest_expiry} warnDays={warn} />}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="table-wrap only-desktop">
            <table className="table">
              <thead><tr><th style={{ width: 28 }} /><th>Item</th><th>Code</th><th>Category</th><th>Location</th><th style={{ width: 120 }}>Level</th><th className="r">On hand</th><th className="r">Par</th><th>Next expiry</th><th /></tr></thead>
              <tbody>
                {list.map((i) => (
                  <tr key={i.id} onClick={() => nav(`/inventory/${i.id}`)}>
                    <td><Mark tone={STOCK_STATUS[i.stock_status].tone} title={STOCK_STATUS[i.stock_status].label} /></td>
                    <td style={{ fontWeight: 500 }}>{i.name}</td>
                    <td><IdChip value={i.sku} /></td>
                    <td className="muted">{i.category_name ?? '—'}</td>
                    <td className="muted">{i.location_name ?? '—'}</td>
                    <td><Meter value={i.on_hand} par={i.par_level} /></td>
                    <td className="r mono">{num(i.on_hand)} <span className="faint">{i.unit}</span></td>
                    <td className="r mono faint">{num(i.par_level)}</td>
                    <td>{i.track_expiry && i.on_hand > 0 ? <Expiry date={i.nearest_expiry} warnDays={warn} /> : <span className="faint">—</span>}</td>
                    <td className="r" onClick={(e) => e.stopPropagation()}>
                      {i.on_hand > 0 && can('stock.consume') && <button className="btn sm" onClick={() => open({ kind: 'use', itemId: i.id })}>Use</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}

function Lots() {
  const { lab } = useSession()
  const warn = lab?.expiry_warning_days ?? 30
  const { data, isLoading } = useQuery({
    queryKey: ['inventory', 'all-lots'],
    queryFn: () => q<{ id: string; item_id: string; lot_number: string | null; quantity: number; effective_expiry: string | null; is_damaged: boolean; opened_at: string | null; items: { name: string; unit: string } }[]>(
      supabase.from('lot_overview').select('id,item_id,lot_number,quantity,effective_expiry,is_damaged,opened_at,items(name,unit)').gt('quantity', 0)
        .order('effective_expiry', { ascending: true, nullsFirst: false }).limit(300)),
  })
  if (isLoading) return <SkeletonRows n={8} />
  if (!data?.length) return <Empty text="No stock lots yet. Receive stock to create lots." />
  return (
    <ul className="ledger">
      {data.map((l) => {
        const d = daysUntil(l.effective_expiry)
        return (
          <li key={l.id}>
            <Link to={`/inventory/${l.item_id}`} className="row">
              <Mark tone={d != null && d < 0 ? 'critical' : d != null && d <= warn ? 'warning' : 'neutral'} />
              <span style={{ minWidth: 0 }}>
                <span className="main-line" style={{ display: 'block' }}>{l.items?.name}</span>
                <span className="sub-line" style={{ display: 'block' }}><span className="mono">{l.lot_number || 'no lot no.'}</span>{l.opened_at ? ' · opened' : ''}{l.is_damaged ? ' · damaged' : ''}</span>
              </span>
              <span className="end"><span className="mono small">{num(l.quantity)} {l.items?.unit}</span><Expiry date={l.effective_expiry} warnDays={warn} /></span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function Moves() {
  const people = usePeopleMap()
  const { data, isLoading } = useQuery({
    queryKey: ['inventory', 'movements'],
    queryFn: () => q<{ id: string; item_id: string; type: string; quantity_delta: number; reason: string | null; performed_by: string | null; created_at: string; items: { name: string; unit: string }; stock_lots: { lot_number: string | null } }[]>(
      supabase.from('stock_movements').select('id,item_id,type,quantity_delta,reason,performed_by,created_at,items(name,unit),stock_lots(lot_number)').order('created_at', { ascending: false }).limit(150)),
  })
  if (isLoading) return <SkeletonRows n={8} />
  if (!data?.length) return <Empty text="No stock movements yet." />
  const LABEL: Record<string, string> = { receive: 'Received', consume: 'Used', adjust: 'Adjusted', discard: 'Discarded', return: 'Returned', transfer: 'Moved' }
  return (
    <ul className="ledger">
      {data.map((m) => (
        <li key={m.id}>
          <Link to={`/inventory/${m.item_id}`} className="row no-mark">
            <span style={{ minWidth: 0 }}>
              <span className="main-line" style={{ display: 'block' }}><b>{LABEL[m.type] ?? m.type}</b> · {m.items?.name}</span>
              <span className="sub-line" style={{ display: 'block' }}>{people.get(m.performed_by ?? '')?.full_name ?? '—'} · <span title={fmtDateTime(m.created_at)}>{relTime(m.created_at)}</span>{m.stock_lots?.lot_number ? ` · lot ${m.stock_lots.lot_number}` : ''}{m.reason ? ` · ${m.reason}` : ''}</span>
            </span>
            <span className={`end mono ${m.quantity_delta < 0 ? '' : 'c-green'}`}>{m.quantity_delta > 0 ? '+' : ''}{num(m.quantity_delta)} <span className="faint small">{m.items?.unit}</span></span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
