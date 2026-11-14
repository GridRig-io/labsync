export type Role = 'admin' | 'supervisor' | 'inventory_officer' | 'staff'
export type Component = 'whole_blood' | 'packed_red_cells' | 'fresh_frozen_plasma' | 'platelets' | 'cryoprecipitate'
export type Abo = 'O' | 'A' | 'B' | 'AB'
export type Rh = 'neg' | 'pos'
export type BloodStatus = 'quarantine' | 'available' | 'reserved' | 'issued' | 'discarded' | 'expired'
export type Screening = 'pending' | 'non_reactive' | 'reactive'
export type Priority = 'low' | 'medium' | 'high' | 'critical'
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'delayed' | 'cancelled'
export type EquipStatus = 'operational' | 'due_service' | 'under_maintenance' | 'out_of_service' | 'retired'
export type Tone = 'critical' | 'warning' | 'ok' | 'info' | 'neutral'

export interface Lab {
  id: string; name: string; short_code: string | null; logo_path: string | null; timezone: string
  expiry_warning_days: number; blood_expiry_warning_days: number; reservation_hold_hours: number
  blood_shelf_life_days: Record<Component, number>
}
export interface Profile {
  id: string; lab_id: string | null; full_name: string | null; email: string | null; role: Role
  job_title: string | null; is_active: boolean; preferences: Record<string, unknown>
}
export interface Named { id: string; name: string }
export interface Location extends Named { kind: string }
export interface InventoryRow {
  id: string; sku: string | null; name: string; unit: string; barcode: string | null; par_level: number
  reorder_qty: number | null; unit_cost: number | null; category_id: string | null; category_name: string | null
  default_location_id: string | null; location_name: string | null; supplier_id: string | null; archived: boolean
  track_expiry: boolean; on_hand: number; active_lots: number; nearest_expiry: string | null
  stock_status: 'expired' | 'out_of_stock' | 'low_stock' | 'ok'
}
export interface Item {
  id: string; sku: string | null; name: string; category_id: string | null; unit: string; manufacturer: string | null
  supplier_id: string | null; barcode: string | null; par_level: number; reorder_qty: number | null
  default_location_id: string | null; track_expiry: boolean; open_stability_days: number | null
  unit_cost: number | null; notes: string | null; archived: boolean
}
export interface Lot {
  id: string; item_id: string; lot_number: string | null; expiry_date: string | null; received_date: string
  supplier_id: string | null; location_id: string | null; opened_at: string | null; is_damaged: boolean
  quantity: number; effective_expiry: string | null
}
export interface Movement {
  id: string; item_id: string; lot_id: string; type: string; quantity_delta: number; reason: string | null
  performed_by: string | null; created_at: string
}
export interface BloodUnit {
  id: string; unit_number: string; component: Component; abo: Abo; rh: Rh; volume_ml: number | null
  collection_date: string; expiry_date: string; donor_code: string | null
  screening_hiv: Screening; screening_hbsag: Screening; screening_hcv: Screening; screening_syphilis: Screening
  status: BloodStatus; location_id: string | null; request_ref: string | null; reserved_until: string | null
  issued_to: string | null; issued_at: string | null; discard_reason: string | null; notes: string | null; created_at: string
}
export interface BloodSummary {
  abo: Abo; rh: Rh; component: Component; available_units: number; quarantine_units: number
  reserved_units: number; expiring_soon_units: number; min_units: number; below_minimum: boolean
}
export interface Equipment {
  id: string; asset_tag: string | null; name: string; category: string | null; manufacturer: string | null
  model: string | null; serial_number: string | null; location_id: string | null; status: EquipStatus
  service_interval_days: number | null; calibration_interval_days: number | null
  last_service_date: string | null; next_service_date: string | null
  last_calibration_date: string | null; next_calibration_date: string | null
  assigned_technician_id: string | null; is_cold_storage: boolean; temp_min_c: number | null
  temp_max_c: number | null; readings_per_day: number; notes: string | null
}
export interface ColdStatus {
  id: string; name: string; asset_tag: string | null; temp_min_c: number | null; temp_max_c: number | null
  readings_per_day: number; last_reading_c: number | null; last_recorded_at: string | null
  last_out_of_range: boolean | null; reading_due: boolean
}
export interface Task {
  id: string; title: string; description: string | null; priority: Priority; status: TaskStatus
  due_at: string | null; assignee_id: string | null; recurrence: string | null
  linked_item_id: string | null; linked_equipment_id: string | null; linked_blood_unit_id: string | null
  completed_at: string | null; created_by: string | null; created_at: string
  task_checklist_items?: { id: string; done: boolean }[]; task_comments?: { count: number }[]
}
export interface Notification {
  id: string; kind: string; severity: 'info' | 'warning' | 'critical'; title: string; body: string | null
  link: string | null; read_at: string | null; created_at: string
}
export interface Activity {
  id: string; created_at: string; actor_id: string | null; kind: string; action: string
  subject: string; qty: number | null; unit: string | null; link: string
}
