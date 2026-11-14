import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SessionProvider, useSession } from './lib/session'
import { ToastProvider } from './lib/toast'
import { ActionsProvider } from './lib/actions'
import { Layout } from './components/Layout'
import { Login, NoLab, ResetPassword } from './features/auth/Login'
import { SkeletonRows } from './components/ui'
import { Today } from './features/today/Today'

const Inventory = lazy(() => import('./features/inventory/Inventory'))
const ItemDetail = lazy(() => import('./features/inventory/ItemDetail'))
const Blood = lazy(() => import('./features/blood/Blood'))
const UnitDetail = lazy(() => import('./features/blood/UnitDetail'))
const EquipmentList = lazy(() => import('./features/equipment/EquipmentList'))
const EquipmentDetail = lazy(() => import('./features/equipment/EquipmentDetail'))
const Tasks = lazy(() => import('./features/tasks/Tasks'))
const TaskDetail = lazy(() => import('./features/tasks/TaskDetail'))
const Settings = lazy(() => import('./features/settings/Settings'))

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true } },
})

function Gate() {
  const { session, ready, profile } = useSession()
  if (location.pathname === '/reset') return <ResetPassword />
  if (!ready) return null
  if (!session) return <Login />
  if (!profile) return <div className="page"><SkeletonRows n={6} /></div>
  if (!profile.is_active) return <NoLab inactive />
  if (!profile.lab_id) return <NoLab />
  return (
    <ActionsProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Today />} />
          <Route path="inventory" element={<Suspense fallback={<SkeletonRows />}><Inventory /></Suspense>} />
          <Route path="inventory/:id" element={<Suspense fallback={<SkeletonRows />}><ItemDetail /></Suspense>} />
          <Route path="blood" element={<Suspense fallback={<SkeletonRows />}><Blood /></Suspense>} />
          <Route path="blood/:id" element={<Suspense fallback={<SkeletonRows />}><UnitDetail /></Suspense>} />
          <Route path="equipment" element={<Suspense fallback={<SkeletonRows />}><EquipmentList /></Suspense>} />
          <Route path="equipment/:id" element={<Suspense fallback={<SkeletonRows />}><EquipmentDetail /></Suspense>} />
          <Route path="tasks" element={<Suspense fallback={<SkeletonRows />}><Tasks /></Suspense>} />
          <Route path="tasks/:id" element={<Suspense fallback={<SkeletonRows />}><TaskDetail /></Suspense>} />
          <Route path="settings/*" element={<Suspense fallback={<SkeletonRows />}><Settings /></Suspense>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ActionsProvider>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <BrowserRouter>
          <SessionProvider>
            <Gate />
          </SessionProvider>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
}
