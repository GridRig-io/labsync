import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !key) {
  // Shown in the console during setup if env vars are missing on Vercel
  console.error('LabSync: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set')
}

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 5 } },
})

/** Turn a Supabase / Postgres error into a sentence a lab scientist can act on. */
export function friendlyError(e: unknown): string {
  const err = e as { message?: string; code?: string; details?: string }
  const msg = err?.message ?? String(e)
  if (err?.code === '42501' || /row-level security|permission denied/i.test(msg)) return "You don't have permission to do this."
  if (err?.code === '23505' || /duplicate key/i.test(msg)) {
    if (/unit_number/.test(msg)) return 'A blood unit with this number already exists.'
    if (/barcode/.test(msg)) return 'Another item already uses this barcode.'
    if (/sku/.test(msg)) return 'Another item already uses this item code.'
    if (/asset_tag/.test(msg)) return 'Another piece of equipment already uses this asset tag.'
    return 'That already exists.'
  }
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'No connection. Check your internet and try again.'
  if (/Invalid login credentials/i.test(msg)) return 'Email or password is incorrect.'
  return msg.replace(/^.*?ERROR:\s*/, '')
}

/** Throw on error, return data otherwise. */
export async function q<T = unknown>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await p
  if (error) throw error
  return data as T
}
