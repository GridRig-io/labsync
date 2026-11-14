-- =====================================================================
-- LabSync v3 · 0004 scheduled checks, realtime, seed
-- =====================================================================

-- Hourly checks for every lab. Dedupe keys stop repeat alerts.
create or replace function public.run_lab_checks()
returns void language plpgsql security definer set search_path = public as $$
declare
  lb public.labs;
  r record;
  inv_roles  public.app_role[] := array['admin','supervisor','inventory_officer']::public.app_role[];
  lead_roles public.app_role[] := array['admin','supervisor']::public.app_role[];
  today text := to_char(current_date, 'YYYY-MM-DD');
  v_count int; v_list text;
begin
  -- 1. Expire blood units, release lapsed reservations
  update public.blood_units set status = 'expired'
   where expiry_date < current_date and status in ('quarantine','available','reserved');

  for r in update public.blood_units set status = 'available', request_ref = null
            where status = 'reserved' and reserved_until < now()
           returning * loop
    perform public.notify_roles(r.lab_id, inv_roles, 'blood_stock', 'info',
      'Reservation lapsed: ' || r.unit_number || ' back to available', null,
      '/blood/' || r.id, 'res-lapse:' || r.id || ':' || today);
  end loop;

  for lb in select * from public.labs loop
    -- 2. Blood expiring soon
    for r in select * from public.blood_units
              where lab_id = lb.id and status = 'available'
                and expiry_date between current_date and current_date + lb.blood_expiry_warning_days loop
      perform public.notify_roles(lb.id, inv_roles, 'expiry', 'warning',
        'Blood unit ' || r.unit_number || ' expires ' || to_char(r.expiry_date, 'DD Mon'),
        r.abo || case r.rh when 'pos' then '+' else '−' end || ' ' || replace(r.component::text, '_', ' '),
        '/blood/' || r.id, 'blood-exp:' || r.id);
    end loop;

    -- 3. Blood below minimum (one summary per day)
    select count(*), string_agg(abo || case rh when 'pos' then '+' else '−' end || ' '
                    || replace(component::text, '_', ' ') || ' (' || available_units || '/' || min_units || ')',
                    ', ' order by component, abo, rh)
      into v_count, v_list
      from public.blood_stock_summary where lab_id = lb.id and below_minimum;
    if v_count > 0 then
      perform public.notify_roles(lb.id, inv_roles, 'blood_stock', 'critical',
        v_count || case when v_count = 1 then ' blood line' else ' blood lines' end || ' below minimum',
        v_list, '/blood', 'blood-min:' || lb.id || ':' || today);
    end if;

    -- 4. Lots expiring / expired
    for r in select lo.*, i.name as item_name from public.lot_overview lo
               join public.items i on i.id = lo.item_id
              where lo.lab_id = lb.id and lo.quantity > 0 and not lo.is_damaged and not i.archived
                and lo.effective_expiry <= current_date + lb.expiry_warning_days loop
      if r.effective_expiry < current_date then
        perform public.notify_roles(lb.id, inv_roles, 'expiry', 'critical',
          r.item_name || ' lot ' || coalesce(r.lot_number, '—') || ' has expired',
          r.quantity || ' left', '/inventory/' || r.item_id, 'lot-expired:' || r.id);
      else
        perform public.notify_roles(lb.id, inv_roles, 'expiry', 'warning',
          r.item_name || ' lot ' || coalesce(r.lot_number, '—') || ' expires ' || to_char(r.effective_expiry, 'DD Mon'),
          r.quantity || ' left', '/inventory/' || r.item_id, 'lot-exp:' || r.id);
      end if;
    end loop;

    -- 5. Low / out of stock (daily)
    for r in select * from public.inventory_overview
              where lab_id = lb.id and not archived and par_level > 0 and on_hand <= par_level loop
      perform public.notify_roles(lb.id, inv_roles, 'low_stock',
        case when r.on_hand = 0 then 'critical'::public.notification_severity else 'warning'::public.notification_severity end,
        r.name || case when r.on_hand = 0 then ' is out of stock' else ' is below par' end,
        r.on_hand || ' ' || r.unit || ' on hand · par ' || r.par_level,
        '/inventory/' || r.id, 'low:' || r.id || ':' || today);
    end loop;

    -- 6. Equipment due within 7 days
    update public.equipment set status = 'due_service'
     where lab_id = lb.id and status = 'operational'
       and (next_service_date <= current_date or next_calibration_date <= current_date);

    for r in select * from public.equipment
              where lab_id = lb.id and status <> 'retired'
                and (next_service_date <= current_date + 7 or next_calibration_date <= current_date + 7) loop
      perform public.notify_roles(lb.id, lead_roles, 'maintenance_due',
        case when least(coalesce(r.next_service_date, 'infinity'), coalesce(r.next_calibration_date, 'infinity')) < current_date
             then 'critical'::public.notification_severity else 'warning'::public.notification_severity end,
        r.name || ' maintenance due',
        'Service ' || coalesce(to_char(r.next_service_date, 'DD Mon'), '—')
          || ' · Calibration ' || coalesce(to_char(r.next_calibration_date, 'DD Mon'), '—'),
        '/equipment/' || r.id, 'maint:' || r.id || ':' || today);
      if r.assigned_technician_id is not null then
        perform public.notify_user(lb.id, r.assigned_technician_id, 'maintenance_due', 'warning',
          r.name || ' maintenance due', null, '/equipment/' || r.id, 'maint:' || r.id || ':' || today);
      end if;
    end loop;

    -- 7. Missed temperature rounds (grace of 1 hour past the round interval)
    for r in select * from public.cold_storage_status cs
              where cs.lab_id = lb.id
                and (cs.last_recorded_at is null
                     or cs.last_recorded_at < now() - make_interval(hours => (24 / cs.readings_per_day) + 1)) loop
      perform public.notify_roles(lb.id, inv_roles, 'temperature', 'warning',
        'Temperature reading missed: ' || r.name,
        coalesce('Last reading ' || to_char(r.last_recorded_at at time zone lb.timezone, 'DD Mon HH24:MI'), 'No readings yet'),
        '/equipment/' || r.id,
        'temp-miss:' || r.id || ':' || to_char(now(), 'YYYY-MM-DD') || ':' ||
          (extract(hour from now())::int / (24 / r.readings_per_day))::text);
    end loop;
  end loop;

  -- 8. Overdue tasks → delayed
  for r in update public.tasks set status = 'delayed'
            where due_at < now() and status in ('pending','in_progress')
           returning * loop
    if r.assignee_id is not null then
      perform public.notify_user(r.lab_id, r.assignee_id, 'task_assigned', 'warning',
        'Overdue: ' || r.title, null, '/tasks/' || r.id, 'task-overdue:' || r.id);
    end if;
  end loop;
end $$;

revoke execute on function public.run_lab_checks() from public, anon, authenticated;
revoke execute on function public.notify_user(uuid, uuid, public.notification_kind, public.notification_severity, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.notify_roles(uuid, public.app_role[], public.notification_kind, public.notification_severity, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

select cron.schedule('labsync-hourly-checks', '5 * * * *', $$select public.run_lab_checks()$$);

-- ---------- realtime ----------
alter publication supabase_realtime add table
  public.notifications, public.tasks, public.blood_units, public.stock_lots, public.temperature_logs;

-- ---------- seed: default lists for a lab (reusable when new labs join) ----------
create or replace function public.seed_lab(p_lab uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.categories (lab_id, name, sort_order) values
    (p_lab,'Reagents',1),(p_lab,'Chemicals',2),(p_lab,'Consumables',3),(p_lab,'Blood bank supplies',4),
    (p_lab,'Protective equipment',5),(p_lab,'Emergency supplies',6),(p_lab,'Stationery',7)
  on conflict do nothing;

  insert into public.locations (lab_id, name, kind) values
    (p_lab,'Main store','store'),(p_lab,'Reagent fridge 1','fridge'),(p_lab,'Blood bank fridge','fridge'),
    (p_lab,'Plasma freezer','freezer'),(p_lab,'Haematology bench','bench'),
    (p_lab,'Chemistry bench','bench'),(p_lab,'Microbiology bench','bench')
  on conflict do nothing;

  -- Blood minimums: placeholders — set to the lab's real targets in Settings
  insert into public.blood_stock_minimums (lab_id, abo, rh, component, min_units)
  select p_lab, a, r, c,
    case
      when c = 'packed_red_cells' then
        case when a = 'O' and r = 'pos' then 10 when a = 'O' then 4
             when a = 'AB' and r = 'neg' then 1 when a = 'AB' then 2
             when r = 'pos' then 6 else 2 end
      when c = 'whole_blood' then case when r = 'pos' then 2 else 1 end
      when c = 'fresh_frozen_plasma' then case when r = 'pos' then 4 else 1 end
      else 0 end
  from unnest(enum_range(null::public.abo_group)) a
  cross join unnest(enum_range(null::public.rh_factor)) r
  cross join unnest(enum_range(null::public.blood_component)) c
  on conflict do nothing;
end $$;

revoke execute on function public.seed_lab(uuid) from public, anon, authenticated;

do $$
declare v_lab uuid;
begin
  insert into public.labs (name, short_code) values ('LabSync Test Laboratory', 'LAB') returning id into v_lab;
  perform public.seed_lab(v_lab);
end $$;
