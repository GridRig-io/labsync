-- =====================================================================
-- LabSync v3 · 0003 triggers & functions
-- =====================================================================

-- updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['labs','profiles','items','stock_lots','blood_units','equipment','tasks']
  loop
    execute format('create trigger trg_touch before update on public.%I
                    for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ---------- new auth user → profile ----------
-- Lab + role come ONLY from app_metadata (settable by the service role, i.e. the
-- manage-staff edge function), never from user-editable user_metadata.
-- Bootstrap: the very first user in the system becomes admin of the first lab.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_lab uuid; v_role public.app_role := 'staff';
begin
  if new.raw_app_meta_data ? 'lab_id' then
    v_lab  := (new.raw_app_meta_data->>'lab_id')::uuid;
    v_role := coalesce((new.raw_app_meta_data->>'role')::public.app_role, 'staff');
  elsif not exists (select 1 from public.profiles) then
    select id into v_lab from public.labs order by created_at limit 1;
    v_role := 'admin';
  end if;

  insert into public.profiles (id, lab_id, email, full_name, role)
  values (new.id, v_lab, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
          v_role);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- profile guard ----------
create or replace function public.guard_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- service role / SQL editor

  if new.lab_id is distinct from old.lab_id then
    raise exception 'Lab membership can only be changed by the system';
  end if;
  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and not public.has_role('admin') then
    raise exception 'Only an admin can change roles or deactivate users';
  end if;
  if new.email is distinct from old.email then
    new.email := old.email;
  end if;
  -- never leave a lab without an active admin
  if old.role = 'admin' and old.is_active and (new.role <> 'admin' or not new.is_active)
     and not exists (select 1 from public.profiles p
                     where p.lab_id = old.lab_id and p.id <> old.id and p.role = 'admin' and p.is_active) then
    raise exception 'The lab needs at least one active admin';
  end if;
  return new;
end $$;

create trigger trg_guard_profile before update on public.profiles
  for each row execute function public.guard_profile();

-- ---------- notification helpers ----------
create or replace function public.notify_user(
  p_lab uuid, p_user uuid, p_kind public.notification_kind, p_severity public.notification_severity,
  p_title text, p_body text, p_link text, p_dedupe text default null)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (lab_id, user_id, kind, severity, title, body, link, dedupe_key)
  values (p_lab, p_user, p_kind, p_severity, p_title, p_body, p_link, p_dedupe)
  on conflict (user_id, dedupe_key) do nothing;
$$;

create or replace function public.notify_roles(
  p_lab uuid, p_roles public.app_role[], p_kind public.notification_kind, p_severity public.notification_severity,
  p_title text, p_body text, p_link text, p_dedupe text default null)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (lab_id, user_id, kind, severity, title, body, link, dedupe_key)
  select p_lab, p.id, p_kind, p_severity, p_title, p_body, p_link, p_dedupe
  from public.profiles p
  where p.lab_id = p_lab and p.is_active and p.role = any(p_roles)
  on conflict (user_id, dedupe_key) do nothing;
$$;

-- ---------- stock movement → lot quantity ----------
create or replace function public.apply_stock_movement()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_lot public.stock_lots;
begin
  select * into v_lot from public.stock_lots where id = new.lot_id for update;
  if v_lot.id is null then raise exception 'Lot not found'; end if;
  if v_lot.item_id <> new.item_id then raise exception 'Lot does not belong to this item'; end if;
  if v_lot.lab_id <> new.lab_id then raise exception 'Lot belongs to another lab'; end if;
  if v_lot.quantity + new.quantity_delta < 0 then
    raise exception 'Not enough stock in this lot' using errcode = 'P0001';
  end if;

  update public.stock_lots
     set quantity = quantity + new.quantity_delta,
         location_id = case when new.type = 'transfer' and new.to_location_id is not null
                            then new.to_location_id else location_id end
   where id = new.lot_id;
  return new;
end $$;

create trigger trg_apply_movement after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

-- lot quantity may only change through movements
create or replace function public.guard_lot_quantity()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.quantity := 0;
  elsif new.quantity is distinct from old.quantity and pg_trigger_depth() < 2 then
    raise exception 'Change stock with a movement (receive, use, adjust, discard)';
  end if;
  return new;
end $$;

create trigger trg_guard_lot_qty before insert or update on public.stock_lots
  for each row execute function public.guard_lot_quantity();

-- ---------- blood unit rules + event log ----------
create or replace function public.guard_blood_unit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_hold int;
begin
  if new.status = 'available' and not (
       new.screening_hiv = 'non_reactive' and new.screening_hbsag = 'non_reactive'
   and new.screening_hcv = 'non_reactive' and new.screening_syphilis = 'non_reactive') then
    raise exception 'Unit cannot be released: all four screens must be non-reactive';
  end if;
  if new.status in ('available','reserved') and 'reactive' in
     (new.screening_hiv, new.screening_hbsag, new.screening_hcv, new.screening_syphilis) then
    new.status := 'quarantine';
  end if;
  if new.status in ('available','reserved') and new.expiry_date < current_date then
    raise exception 'Unit has expired';
  end if;

  if new.status = 'reserved' then
    if coalesce(new.request_ref, '') = '' then raise exception 'A request reference is required to reserve'; end if;
    if new.reserved_until is null or (tg_op = 'UPDATE' and old.status <> 'reserved') then
      select reservation_hold_hours into v_hold from public.labs where id = new.lab_id;
      new.reserved_until := coalesce(new.reserved_until, now() + make_interval(hours => coalesce(v_hold, 48)));
    end if;
  else
    new.reserved_until := null;
  end if;

  if new.status = 'issued' and new.issued_at is null then new.issued_at := now(); end if;
  if new.status = 'discarded' and coalesce(new.discard_reason, '') = '' then
    raise exception 'A discard reason is required';
  end if;
  return new;
end $$;

create trigger trg_guard_blood before insert or update on public.blood_units
  for each row execute function public.guard_blood_unit();

create or replace function public.log_blood_unit_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.blood_unit_events (lab_id, unit_id, from_status, to_status, note, performed_by)
    values (new.lab_id, new.id, null, new.status, 'Unit received', auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.blood_unit_events (lab_id, unit_id, from_status, to_status, note, performed_by)
    values (new.lab_id, new.id, old.status, new.status,
            case new.status
              when 'discarded' then new.discard_reason
              when 'issued'    then concat_ws(' · ', new.request_ref, new.issued_to)
              when 'reserved'  then new.request_ref
              else null end,
            auth.uid());
  end if;
  return new;
end $$;

create trigger trg_blood_event after insert or update on public.blood_units
  for each row execute function public.log_blood_unit_event();

-- ---------- maintenance → equipment dates ----------
create or replace function public.apply_maintenance()
returns trigger language plpgsql security definer set search_path = public as $$
declare e public.equipment;
begin
  select * into e from public.equipment where id = new.equipment_id;
  if e.lab_id <> new.lab_id then raise exception 'Equipment belongs to another lab'; end if;
  if new.kind = 'service' then
    new.next_due_date := coalesce(new.next_due_date, new.performed_on + e.service_interval_days);
    update public.equipment set last_service_date = new.performed_on, next_service_date = new.next_due_date,
           status = case when status in ('due_service','under_maintenance') then 'operational' else status end
     where id = e.id;
  elsif new.kind = 'calibration' then
    new.next_due_date := coalesce(new.next_due_date, new.performed_on + e.calibration_interval_days);
    update public.equipment set last_calibration_date = new.performed_on, next_calibration_date = new.next_due_date,
           status = case when status in ('due_service','under_maintenance') then 'operational' else status end
     where id = e.id;
  end if;
  return new;
end $$;

create trigger trg_apply_maintenance before insert on public.maintenance_logs
  for each row execute function public.apply_maintenance();

-- ---------- temperature → out-of-range flag + alert ----------
create or replace function public.check_temperature()
returns trigger language plpgsql security definer set search_path = public as $$
declare e public.equipment;
begin
  select * into e from public.equipment where id = new.equipment_id;
  if e.lab_id <> new.lab_id then raise exception 'Equipment belongs to another lab'; end if;
  new.out_of_range := (e.temp_min_c is not null and new.reading_c < e.temp_min_c)
                   or (e.temp_max_c is not null and new.reading_c > e.temp_max_c);
  if new.out_of_range then
    perform public.notify_roles(new.lab_id, array['admin','supervisor','inventory_officer']::public.app_role[],
      'temperature', 'critical',
      e.name || ' out of range: ' || new.reading_c || ' °C',
      'Allowed ' || coalesce(e.temp_min_c::text,'–') || ' to ' || coalesce(e.temp_max_c::text,'–') || ' °C'
        || coalesce('. Action: ' || new.action_taken, ''),
      '/equipment/' || e.id, 'temp:' || new.id);
  end if;
  return new;
end $$;

create trigger trg_check_temperature before insert on public.temperature_logs
  for each row execute function public.check_temperature();

-- ---------- tasks ----------
create or replace function public.task_set_completed_at()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status <> 'completed') then
    new.completed_at := now();
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end $$;

create or replace function public.task_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_next timestamptz;
begin
  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and new.assignee_id is distinct from auth.uid() then
    perform public.notify_user(new.lab_id, new.assignee_id, 'task_assigned',
      case new.priority when 'critical' then 'critical'::public.notification_severity
                        when 'high' then 'warning'::public.notification_severity
                        else 'info'::public.notification_severity end,
      'New task: ' || new.title, null, '/tasks/' || new.id,
      'task-assign:' || new.id || ':' || new.assignee_id);
  end if;

  if tg_op = 'UPDATE' and new.status = 'completed' and old.status <> 'completed' then
    if new.created_by is not null and new.created_by is distinct from auth.uid() then
      perform public.notify_user(new.lab_id, new.created_by, 'task_completed', 'info',
        'Done: ' || new.title, null, '/tasks/' || new.id, 'task-done:' || new.id);
    end if;
    if new.recurrence is not null then
      v_next := coalesce(new.due_at, now()) + case new.recurrence
                  when 'daily' then interval '1 day' when 'weekly' then interval '7 days'
                  else interval '1 month' end;
      insert into public.tasks (lab_id, title, description, priority, status, due_at, assignee_id, recurrence,
                                linked_item_id, linked_equipment_id, linked_blood_unit_id, created_by)
      values (new.lab_id, new.title, new.description, new.priority, 'pending', v_next, new.assignee_id,
              new.recurrence, new.linked_item_id, new.linked_equipment_id, new.linked_blood_unit_id, new.created_by);
    end if;
  end if;
  return new;
end $$;

create trigger trg_task_completed_at before insert or update on public.tasks
  for each row execute function public.task_set_completed_at();
create trigger trg_task_events after insert or update on public.tasks
  for each row execute function public.task_events();

-- ---------- audit ----------
create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_row jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_log (lab_id, table_name, record_id, action, actor_id, old_data, new_data)
  values (coalesce((v_row->>'lab_id')::uuid, case when tg_table_name = 'labs' then (v_row->>'id')::uuid end),
          tg_table_name, v_row->>'id', lower(tg_op), auth.uid(),
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['labs','profiles','items','stock_lots','stock_movements','blood_units',
                           'blood_stock_minimums','equipment','maintenance_logs','tasks',
                           'categories','locations','suppliers']
  loop
    execute format('create trigger trg_audit after insert or update or delete on public.%I
                    for each row execute function public.audit_trigger()', t);
  end loop;
end $$;
