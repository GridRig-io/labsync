import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Search } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useSession } from '../lib/session'
import { useActions } from '../lib/actions'
import { Sheet } from './ui'
import { groupLabel } from '../lib/format'

interface Hit { group: string; label: string; sub?: string; to: string }

async function lookup(term: string): Promise<Hit[]> {
  const t = term.trim()
  if (!t) return []
  const like = `%${t.replace(/[%_,()]/g, ' ')}%`
  const [items, lots, blood, equip, tasks] = await Promise.all([
    supabase.from('items').select('id,name,sku,barcode').or(`barcode.eq.${t},sku.ilike.${like},name.ilike.${like}`).eq('archived', false).limit(8),
    supabase.from('stock_lots').select('id,item_id,lot_number,items(name)').ilike('lot_number', like).limit(5),
    supabase.from('blood_units').select('id,unit_number,abo,rh,status').ilike('unit_number', like).limit(6),
    supabase.from('equipment').select('id,name,asset_tag').or(`asset_tag.ilike.${like},name.ilike.${like}`).limit(5),
    supabase.from('tasks').select('id,title,status').ilike('title', like).neq('status', 'cancelled').limit(5),
  ])
  const hits: Hit[] = []
  items.data?.forEach((i) => hits.push({ group: 'Items', label: i.name, sub: i.sku ?? i.barcode ?? undefined, to: `/inventory/${i.id}` }))
  lots.data?.forEach((l) => hits.push({ group: 'Lots', label: l.lot_number ?? '', sub: (l.items as unknown as { name: string } | null)?.name, to: `/inventory/${l.item_id}` }))
  blood.data?.forEach((b) => hits.push({ group: 'Blood units', label: b.unit_number, sub: `${groupLabel(b.abo, b.rh)} · ${b.status}`, to: `/blood/${b.id}` }))
  equip.data?.forEach((e) => hits.push({ group: 'Equipment', label: e.name, sub: e.asset_tag ?? undefined, to: `/equipment/${e.id}` }))
  tasks.data?.forEach((k) => hits.push({ group: 'Tasks', label: k.title, sub: k.status, to: `/tasks/${k.id}` }))
  return hits
}

export function ScanSheet({ onClose }: { onClose: () => void }) {
  const nav = useNavigate()
  const { can } = useSession()
  const { open } = useActions()
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [camera, setCamera] = useState(false)
  const [camErr, setCamErr] = useState('')
  const video = useRef<HTMLVideoElement>(null)
  const scanned = useRef(false)

  useEffect(() => {
    const t = setTimeout(() => { if (term.trim().length >= 2) lookup(term).then(setHits); else setHits(null) }, 220)
    return () => clearTimeout(t)
  }, [term])

  useEffect(() => {
    if (!camera) return
    let stream: MediaStream | undefined; let raf = 0; let stopped = false
    ;(async () => {
      try {
        const Native = (window as unknown as { BarcodeDetector?: new (o?: object) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector
        const Detector = Native ?? (await import('barcode-detector/ponyfill')).BarcodeDetector
        const det = new Detector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'data_matrix', 'itf', 'codabar'] })
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (stopped || !video.current) return
        video.current.srcObject = stream
        await video.current.play()
        const tick = async () => {
          if (stopped || !video.current) return
          try {
            const codes = await det.detect(video.current)
            if (codes[0]?.rawValue && !scanned.current) {
              scanned.current = true
              navigator.vibrate?.(60)
              const code = codes[0].rawValue.trim()
              const res = await lookup(code)
              setCamera(false); setTerm(code); setHits(res)
              if (res.length === 1) { nav(res[0]!.to); onClose() }
              return
            }
          } catch { /* frame not ready */ }
          raf = window.setTimeout(tick, 250) as unknown as number
        }
        tick()
      } catch (e) {
        setCamErr((e as Error).name === 'NotAllowedError' ? 'Camera permission was denied. Allow it in your browser settings, or type the code.' : 'Camera not available on this device. Type the code instead.')
        setCamera(false)
      }
    })()
    return () => { stopped = true; clearTimeout(raf); stream?.getTracks().forEach((t) => t.stop()); scanned.current = false }
  }, [camera, nav, onClose])

  const groups = hits ? [...new Set(hits.map((h) => h.group))] : []
  return (
    <Sheet open onClose={onClose} title="Scan or look up">
      {camera ? (
        <div className="scanner" style={{ margin: '-20px -20px 16px', width: 'calc(100% + 40px)' }}>
          <video ref={video} playsInline muted />
          <div className="reticle" />
        </div>
      ) : (
        <button className="btn primary block xl" style={{ marginBottom: 16 }} onClick={() => { setCamErr(''); setCamera(true) }}><Camera size={20} /> Scan barcode / QR</button>
      )}
      {camErr && <p className="banner warning"><span className="b-body small">{camErr}</span></p>}
      <div className="search" style={{ marginBottom: 12 }}>
        <Search size={18} />
        <input className="input" placeholder="Type a name, code, lot or unit number" value={term} onChange={(e) => setTerm(e.target.value)} autoFocus={!camera} aria-label="Search everything" />
      </div>
      {hits && hits.length === 0 && (
        <div className="empty">
          <p className="muted">Nothing matches “{term}”.</p>
          {can('inventory.write') && <button className="btn" onClick={() => open({ kind: 'item', barcode: term.trim() })}>Create item with this code</button>}
        </div>
      )}
      {groups.map((g) => (
        <div key={g} className="section" style={{ marginBottom: 16 }}>
          <div className="sec-head"><span className="label">{g}</span></div>
          <ul className="ledger">
            {hits!.filter((h) => h.group === g).map((h, i) => (
              <li key={i}><button className="row no-mark" onClick={() => { nav(h.to); onClose() }}>
                <span className="main-line">{h.label}</span><span className="end mono small faint">{h.sub}</span>
              </button></li>
            ))}
          </ul>
        </div>
      ))}
      {!hits && !camera && <p className="small faint">Tip: on a computer press Ctrl + K to open this from anywhere.</p>}
    </Sheet>
  )
}
