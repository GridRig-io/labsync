import { useNavigate } from 'react-router-dom'
import { Minus, PackagePlus, Thermometer, Droplet, ClipboardPlus, ScanLine } from 'lucide-react'
import { useActions } from '../lib/actions'
import { useSession } from '../lib/session'
import { Sheet } from './ui'
import { UseStockSheet, ReceiveSheet, ItemSheet } from '../features/inventory/sheets'
import { TempSheet } from '../features/equipment/sheets'
import { BloodAddSheet } from '../features/blood/sheets'
import { TaskSheet } from '../features/tasks/sheets'
import { ScanSheet } from './ScanSheet'

/** Renders whichever global quick-action sheet is open. */
export function QuickSheets() {
  const { action, open, close } = useActions()
  const { can } = useSession()
  const nav = useNavigate()
  if (!action) return null
  switch (action.kind) {
    case 'use': return <UseStockSheet itemId={action.itemId} lotId={action.lotId} onClose={close} />
    case 'receive': return <ReceiveSheet itemId={action.itemId} onClose={close} />
    case 'temp': return <TempSheet equipmentId={action.equipmentId} onClose={close} />
    case 'blood-add': return <BloodAddSheet onClose={close} />
    case 'task': return <TaskSheet taskId={action.taskId} preset={action.preset} onClose={close} />
    case 'scan': return <ScanSheet onClose={close} />
    case 'item': return <ItemSheet itemId={action.itemId} barcode={action.barcode} onClose={close} onSaved={(id) => nav(`/inventory/${id}`)} />
    case 'quick': {
      const opts = [
        { k: 'use', t: 'Use stock', s: 'Record what you took', icon: Minus, show: can('stock.consume') },
        { k: 'temp', t: 'Log temperature', s: 'Fridge & freezer rounds', icon: Thermometer, show: true },
        { k: 'receive', t: 'Receive stock', s: 'New delivery or lot', icon: PackagePlus, show: can('inventory.write') },
        { k: 'blood-add', t: 'Add blood unit', s: 'Into quarantine', icon: Droplet, show: can('blood.write') },
        { k: 'task', t: 'New task', s: 'For you or the team', icon: ClipboardPlus, show: true },
        { k: 'scan', t: 'Scan / look up', s: 'Barcode, lot, unit no.', icon: ScanLine, show: true },
      ] as const
      return (
        <Sheet open onClose={close} title="Record">
          <div className="quick-grid" style={{ margin: '-20px -20px 0' }}>
            {opts.filter((o) => o.show).map((o) => (
              <button key={o.k} className="quick" onClick={() => open({ kind: o.k } as never)}>
                <o.icon size={24} strokeWidth={1.75} />
                <span><span className="q-t" style={{ display: 'block' }}>{o.t}</span><span className="small muted">{o.s}</span></span>
              </button>
            ))}
          </div>
        </Sheet>
      )
    }
  }
}
