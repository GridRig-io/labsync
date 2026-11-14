-- =====================================================================
-- LabSync v3 · 0001 core tables
-- Multi-lab ready: every row belongs to a lab (lab_id). A user belongs to
-- exactly one lab (profiles.lab_id). Today there is one lab; more can be
-- added later with no schema change.
-- =====================================================================

create extension if not exists pg_cron;

-- ---------- enums ----------
create type public.app_role              as enum ('admin','supervisor','inventory_officer','staff');
create type public.movement_type         as enum ('receive','consume','adjust','transfer','discard','return');
create type public.blood_component       as enum ('whole_blood','packed_red_cells','fresh_frozen_plasma','platelets','cryoprecipitate');
create type public.abo_group             as enum ('O','A','B','AB');
create type public.rh_factor             as enum ('neg','pos');
create type public.blood_unit_status     as enum ('quarantine','available','reserved','issued','discarded','expired');
create type public.screening_result      as enum ('pending','non_reactive','reactive');
create type public.task_priority         as enum ('low','medium','high','critical');
create type public.task_status           as enum ('pending','in_progress','completed','delayed','cancelled');
create type public.equipment_status      as enum ('operational','due_service','under_maintenance','out_of_service','retired');
create type public.maintenance_kind      as enum ('service','calibration','repair','inspection');
create type public.notification_kind     as enum ('low_stock','expiry','blood_stock','task_assigned','task_completed','maintenance_due','temperature','reminder','announcement');
create type public.notification_severity as enum ('info','warning','critical');

-- ---------- labs ----------
create table public.labs (
  id                         uuid primary key default gen_random_uuid(),
  name                       text not null default 'My Laboratory',
  short_code                 text,                       -- e.g. "SAML", shown in headers / labels
  logo_path                  text,
  timezone                   text not null default 'Africa/Lagos',
  expiry_warning_days        int  not null default 30 check (expiry_warning_days between 1 and 365),
  blood_expiry_warning_days  int  not null default 3  check (blood_expiry_warning_days between 1 and 60),
  reservation_hold_hours     int  not null default 48 check (reservation_hold_hours between 1 and 720),
  -- Default shelf life (days) used to pre-fill blood unit expiry. Set to the lab's SOP.
  blood_shelf_life_days      jsonb not null default
    '{"whole_blood":35,"packed_red_cells":35,"fresh_frozen_plasma":365,"platelets":5,"cryoprecipitate":365}',
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  lab_id       uuid references public.labs(id) on delete set null,
  full_name    text,
  email        text,
  role         public.app_role not null default 'staff',
  job_title    text,
  is_active    boolean not null default true,
  preferences  jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.profiles (lab_id);

-- The current user's lab (null if not attached to a lab or deactivated)
create or replace function public.my_lab()
returns uuid language sql stable security definer set search_path = public as $$
  select lab_id from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.my_role()
returns public.app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active and lab_id is not null
$$;

create or replace function public.has_role(variadic roles public.app_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = any(roles), false)
$$;

-- ---------- reference lists ----------
create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  lab_id     uuid not null default public.my_lab() references public.labs(id) on delete cascade,
  name       text not null,
  sort_order int  not null default 0,
  unique (lab_id, name)
);

create table public.locations (
  id      uuid primary key default gen_random_uuid(),
  lab_id  uuid not null default public.my_lab() references public.labs(id) on delete cascade,
  name    text not null,
  kind    text not null default 'store' check (kind in ('store','shelf','bench','fridge','freezer','room')),
  unique (lab_id, name)
);

create table public.suppliers (
  id      uuid primary key default gen_random_uuid(),
  lab_id  uuid not null default public.my_lab() references public.labs(id) on delete cascade,
  name    text not null,
  contact text, phone text, email text, notes text,
  unique (lab_id, name)
);

-- ---------- inventory ----------
create table public.items (
  id                   uuid primary key default gen_random_uuid(),
  lab_id               uuid not null default public.my_lab() references public.labs(id) on delete cascade,
  sku                  text,
  name                 text not null,
  category_id          uuid references public.categories(id) on delete set null,
  unit                 text not null default 'pcs',
  manufacturer         text,
  supplier_id          uuid references public.suppliers(id) on delete set null,
  barcode              text,
  par_level            numeric not null default 0 check (par_level >= 0),
  reorder_qty          numeric check (reorder_qty >= 0),
  default_location_id  uuid references public.locations(id) on delete set null,
  track_expiry         boolean not null default true,
  open_stability_days  int check (open_stability_days > 0),
  unit_cost            numeric check (unit_cost >= 0),
  notes                text,
  archived             boolean not null default false,
  created_by           uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (lab_id, sku),
  unique (lab_id, barcode)
);
create index on public.items (lab_id, name);

create table public.stock_lots (
  id             uuid primary key default gen_random_uuid(),
  lab_id         uuid not null default public.my_lab() references public.labs(id) on delete cascade,
  item_id        uuid not null references public.items(id) on delete cascade,
  lot_number     text,
  expiry_date    date,
  received_date  date not null default current_date,
  supplier_id    uuid references public.suppliers(id) on delete set null,
  location_id    uuid references public.locations(id) on delete set null,
  opened_at      date,
  is_damaged     boolean not null default false,
  quantity       numeric not null default 0 check (quantity >= 0),  -- maintained by trigger only
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on public.stock_lots (item_id);
create index on public.stock_lots (lab_id, expiry_date) where quantity > 0;

create table public.stock_movements (
  id              uuid primary key default gen_random_uuid(),
  lab_id          uuid not null default public.my_lab() references public.labs(id) on delete cascade,
  item_id         uuid not null references public.items(id) on delete cascade,
  lot_id          uuid not null references public.stock_lots(id) on delete cascade,
  type            public.movement_type not null,
  quantity_delta  numeric not null check (quantity_delta <> 0),
  reason          text,
  to_location_id  uuid references public.locations(id) on delete set null,
  performed_by    uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  constraint movement_sign check (
       (type in ('receive','return')  and quantity_delta > 0)
    or (type in ('consume','discard') and quantity_delta < 0)
    or (type in ('adjust','transfer'))
  )
);
create index on public.stock_movements (lab_id, created_at desc);
create index on public.stock_movements (item_id, created_at desc);

-- ---------- blood bank ----------
create table public.blood_units (
  id                  uuid primary key default gen_random_uuid(),
  lab_id              uuid not null default public.my_lab() references public.labs(id) on delete cascade,
  unit_number         text not null,
  component           public.blood_component not null,
  abo                 public.abo_group not null,
  rh                  public.rh_factor not null,
  volume_ml           int check (volume_ml > 0),
  collection_date     date not null,
  expiry_date         date not null,
  donor_code          text,
  screening_hiv       public.screening_result not null default 'pending',
  screening_hbsag     public.screening_result not null default 'pending',
  screening_hcv       public.screening_result not null default 'pending',
  screening_syphilis  public.screening_result not null default 'pending',
  status              public.blood_unit_status not null default 'quarantine',
  location_id         uuid references public.locations(id) on delete set null,
  request_ref         text,             -- reservation / issue reference (no patient names)
  reserved_until      timestamptz,      -- reservation auto-releases after this
  issued_to           text,             -- ward / department
  issued_at           timestamptz,
  discard_reason      text,
  notes               text,
  created_by          uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (lab_id, unit_number),
  check (expiry_date >= collection_date)
);
create index on public.blood_units (lab_id, status, abo, rh, component);
create index on public.blood_units (lab_id, expiry_date);

create table public.blood_unit_events (
  id            uuid primary key default gen_random_uuid(),
  lab_id        uuid not null references public.labs(id) on delete cascade,
  unit_id       uuid not null references public.blood_units(id) on delete cascade,
  from_status   public.blood_unit_status,
  to_status     public.blood_unit_status not null,
  note          text,
  performed_by  uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index on public.blood_unit_events (unit_id, created_at desc);
create index on public.blood_unit_events (lab_id, created_at desc);

create table public.blood_stock_minimums (
  lab_id     uuid not null default public.my_lab() references public.labs(id) on delete cascade,
  abo        public.abo_group not null,
  rh         public.rh_factor not null,
  component  public.blood_component not null,
  min_units  int not null default 0 check (min_units >= 0),
  primary key (lab_id, abo, rh, component)
);

-- ---------- equipment & cold chain ----------
create table public.equipment (
  id                         uuid primary key default gen_random_uuid(),
  lab_id                     uuid not null default public.my_lab() references public.labs(id) on delete cascade,
  asset_tag                  text,
  name                       text not null,
  category                   text,
  manufacturer               text,
  model                      text,
  serial_number              text,
  location_id                uuid references public.locations(id) on delete set null,
  status                     public.equipment_status not null default 'operational',
  service_interval_days      int check (service_interval_days > 0),
  calibration_interval_days  int check (calibration_interval_days > 0),
  last_service_date          date,
  next_service_date          date,
  last_calibration_date      date,
  next_calibration_date      date,
  assigned_technician_id     uuid references public.profiles(id) on delete set null,
  is_cold_storage            boolean not null default false,
  temp_min_c                 numeric,
  temp_max_c                 numeric,
  readings_per_day           int not null default 2 check (readings_per_day between 1 and 24),
  notes                      text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (lab_id, asset_tag),
  check (temp_min_c is null or temp_max_c is null or temp_min_c < temp_max_c)
);

create table public.maintenance_logs (
  id              uuid primary key default gen_random_uuid(),
  lab_id          uuid not null default public.my_lab() references public.labs(id) on delete cascade,
  equipment_id    uuid not null references public.equipment(id) on delete cascade,
  kind            public.maintenance_kind not null,
  performed_on    date not null default current_date,
  technician_id   uuid references public.profiles(id) on delete set null default auth.uid(),
  external_vendor text,
  description     text,
  cost            numeric check (cost >= 0),
  downtime_hours  numeric check (downtime_hours >= 0),
  next_due_date   date,
  created_by      uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now()
);
create index on public.maintenance_logs (equipment_id, performed_on desc);

create table public.temperature_logs (
  id            uuid primary key default gen_random_uuid(),
  lab_id        uuid not null default public.my_lab() references public.labs(id) on delete cascade,
  equipment_id  uuid not null references public.equipment(id) on delete cascade,
  reading_c     numeric not null check (reading_c between -100 and 100),
  recorded_at   timestamptz not null default now(),
  out_of_range  boolean not null default false,
  action_taken  text,             -- required by UI when out of range
  recorded_by   uuid references public.profiles(id) on delete set null default auth.uid()
);
create index on public.temperature_logs (equipment_id, recorded_at desc);

-- ---------- tasks ----------
create table public.tasks (
  id                    uuid primary key default gen_random_uuid(),
  lab_id                uuid not null default public.my_lab() references public.labs(id) on delete cascade,
  title                 text not null,
  description           text,
  priority              public.task_priority not null default 'medium',
  status                public.task_status   not null default 'pending',
  due_at                timestamptz,
  assignee_id           uuid references public.profiles(id) on delete set null,
  recurrence            text check (recurrence in ('daily','weekly','monthly')),
  linked_item_id        uuid references public.items(id) on delete set null,
  linked_equipment_id   uuid references public.equipment(id) on delete set null,
  linked_blood_unit_id  uuid references public.blood_units(id) on delete set null,
  completed_at          timestamptz,
  created_by            uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on public.tasks (lab_id, status, due_at);
create index on public.tasks (assignee_id, status);

create table public.task_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  lab_id      uuid not null default public.my_lab() references public.labs(id) on delete cascade,
  task_id     uuid not null references public.tasks(id) on delete cascade,
  label       text not null,
  done        boolean not null default false,
  sort_order  int not null default 0
);
create index on public.task_checklist_items (task_id);

create table public.task_comments (
  id          uuid primary key default gen_random_uuid(),
  lab_id      uuid not null default public.my_lab() references public.labs(id) on delete cascade,
  task_id     uuid not null references public.tasks(id) on delete cascade,
  author_id   uuid references public.profiles(id) on delete set null default auth.uid(),
  body        text not null,
  created_at  timestamptz not null default now()
);
create index on public.task_comments (task_id, created_at);

-- ---------- notifications & audit ----------
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  lab_id       uuid not null references public.labs(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  kind         public.notification_kind not null,
  severity     public.notification_severity not null default 'info',
  title        text not null,
  body         text,
  link         text,
  dedupe_key   text,
  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index on public.notifications (user_id, read_at, created_at desc);

create table public.audit_log (
  id          bigserial primary key,
  lab_id      uuid,
  table_name  text not null,
  record_id   text,
  action      text not null,
  actor_id    uuid,
  old_data    jsonb,
  new_data    jsonb,
  created_at  timestamptz not null default now()
);
create index on public.audit_log (lab_id, created_at desc);
