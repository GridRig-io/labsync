import { useQuery } from '@tanstack/react-query'
import { supabase, q } from './supabase'
import type { Location, Named, Profile } from './types'

const STALE = 5 * 60 * 1000

export function useLocations() {
  return useQuery({ queryKey: ['lists', 'locations'], staleTime: STALE,
    queryFn: () => q<Location[]>(supabase.from('locations').select('id,name,kind').order('name')) })
}
export function useCategories() {
  return useQuery({ queryKey: ['lists', 'categories'], staleTime: STALE,
    queryFn: () => q<(Named & { sort_order: number })[]>(supabase.from('categories').select('id,name,sort_order').order('sort_order').order('name')) })
}
export function useSuppliers() {
  return useQuery({ queryKey: ['lists', 'suppliers'], staleTime: STALE,
    queryFn: () => q<(Named & { contact: string | null; phone: string | null; email: string | null })[]>(supabase.from('suppliers').select('id,name,contact,phone,email').order('name')) })
}
export function usePeople() {
  return useQuery({ queryKey: ['lists', 'people'], staleTime: STALE,
    queryFn: () => q<Profile[]>(supabase.from('profiles').select('*').order('full_name')) })
}
/** id → display name */
export function usePeopleMap() {
  const { data } = usePeople()
  const map = new Map<string, Profile>()
  data?.forEach((p) => map.set(p.id, p))
  return map
}
export function nameOf(map: Map<string, { name?: string; full_name?: string | null }>, id: string | null | undefined) {
  if (!id) return '—'
  const v = map.get(id) as { name?: string; full_name?: string | null } | undefined
  return v?.full_name ?? v?.name ?? '—'
}
