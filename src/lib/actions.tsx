import { createContext, useContext, useState, type ReactNode } from 'react'

/** Global quick actions: any screen can open these sheets. */
export type Action =
  | { kind: 'use'; itemId?: string; lotId?: string }
  | { kind: 'receive'; itemId?: string }
  | { kind: 'temp'; equipmentId?: string }
  | { kind: 'blood-add' }
  | { kind: 'task'; taskId?: string; preset?: Record<string, string> }
  | { kind: 'scan' }
  | { kind: 'quick' }
  | { kind: 'item'; itemId?: string; barcode?: string }

const Ctx = createContext<{ action: Action | null; open: (a: Action) => void; close: () => void }>({ action: null, open: () => {}, close: () => {} })

export function ActionsProvider({ children }: { children: ReactNode }) {
  const [action, setAction] = useState<Action | null>(null)
  return <Ctx.Provider value={{ action, open: setAction, close: () => setAction(null) }}>{children}</Ctx.Provider>
}
export const useActions = () => useContext(Ctx)
