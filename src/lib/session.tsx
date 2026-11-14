import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, q } from './supabase'
import { setTimezone } from './format'
import type { Lab, Profile, Role } from './types'

export type Perm =
  | 'inventory.write' | 'stock.consume' | 'blood.write' | 'blood.minimums'
  | 'equipment.write' | 'tasks.assign' | 'admin'

const PERMS: Record<Perm, Role[]> = {
  'inventory.write': ['admin', 'supervisor', 'inventory_officer'],
  'stock.consume': ['admin', 'supervisor', 'inventory_officer', 'staff'],
  'blood.write': ['admin', 'supervisor', 'inventory_officer'],
  'blood.minimums': ['admin', 'supervisor'],
  'equipment.write': ['admin', 'supervisor'],
  'tasks.assign': ['admin', 'supervisor'],
  admin: ['admin'],
}

interface Ctx {
  session: Session | null
  ready: boolean
  profile: Profile | null
  lab: Lab | null
  can: (p: Perm) => boolean
  logoUrl: string | null
}
const SessionCtx = createContext<Ctx>({ session: null, ready: false, profile: null, lab: null, can: () => false, logoUrl: null })

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const qc = useQueryClient()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data: sub } = supabase.auth.onAuthStateChange((evt, s) => {
      setSession(s)
      if (evt === 'SIGNED_OUT') qc.clear()
    })
    return () => sub.subscription.unsubscribe()
  }, [qc])

  const uid = session?.user.id
  const { data: profile } = useQuery({
    queryKey: ['me', uid],
    enabled: !!uid,
    queryFn: () => q<Profile>(supabase.from('profiles').select('*').eq('id', uid!).single()),
  })
  const { data: lab } = useQuery({
    queryKey: ['lab', profile?.lab_id],
    enabled: !!profile?.lab_id && profile.is_active,
    queryFn: () => q<Lab>(supabase.from('labs').select('*').eq('id', profile!.lab_id!).single()),
  })

  useEffect(() => { if (lab?.timezone) setTimezone(lab.timezone) }, [lab?.timezone])

  // Realtime: refresh affected screens live
  useEffect(() => {
    if (!uid || !profile?.lab_id) return
    const map: Record<string, string[][]> = {
      notifications: [['notifications']],
      tasks: [['tasks'], ['today']],
      blood_units: [['blood'], ['today']],
      stock_lots: [['inventory'], ['today']],
      temperature_logs: [['equipment'], ['today']],
    }
    const ch = supabase.channel('labsync-live')
    for (const table of Object.keys(map)) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table, ...(table === 'notifications' ? { filter: `user_id=eq.${uid}` } : {}) },
        () => map[table]!.forEach((key) => qc.invalidateQueries({ queryKey: key })))
    }
    ch.subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [uid, profile?.lab_id, qc])

  const value = useMemo<Ctx>(() => {
    const role = profile?.is_active && profile.lab_id ? profile.role : null
    const logoUrl = lab?.logo_path ? supabase.storage.from('branding').getPublicUrl(lab.logo_path).data.publicUrl : null
    return {
      session, ready, profile: profile ?? null, lab: lab ?? null, logoUrl,
      can: (p) => !!role && PERMS[p].includes(role),
    }
  }, [session, ready, profile, lab])

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>
}

export const useSession = () => useContext(SessionCtx)
