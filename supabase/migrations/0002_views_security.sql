-- =====================================================================
-- LabSync v3 · 0002 views + row level security
-- =====================================================================

-- ---------- views (security_invoker: caller's RLS applies) ----------

-- Lot with effective expiry: earlier of printed expiry and opened + stability
create view public.lot_overview with (security_invoker = true) as
select l.*,
       case when l.opened_at is not null and i.open_stability_days is not null
            then least(coalesce(l.expiry_date, 'infinity'::date), l.opened_at + i.open_stability_days)
            else l.expiry_date end as effective_expiry
from public.stock_lots l
join public.items i on i.id = l.item_id;

create view public.inventory_overview with (security_invoker = true) as
with lots as (
  select item_id,
         coalesce(sum(quantity) filter (where not is_damaged), 0) as on_hand,
         min(effective_expiry) filter (where quantity > 0 and not is_damaged) as nearest_expiry,
         count(*) filter (where quantity > 0) as active_lots,
         bool_or(quantity > 0 and effective_expiry < current_date) as has_expired_stock
  from public.lot_overview
  group by item_id
)
select i.id, i.lab_id, i.sku, i.name, i.unit, i.barcode, i.par_level, i.reorder_qty, i.unit_cost,
       i.category_id, c.name as category_name,
       i.default_location_id, loc.name as location_name,
       i.supplier_id, i.archived, i.track_expiry,
       coalesce(l.on_hand, 0) as on_hand,
       coalesce(l.active_lots, 0) as active_lots,
       l.nearest_expiry,
       case
         when coalesce(l.has_expired_stock, false)  then 'expired'
         when coalesce(l.on_hand, 0) = 0            then 'out_of_stock'
         when coalesce(l.on_hand, 0) <= i.par_level then 'low_stock'
         else 'ok'
       end as stock_status
from public.items i
left join lots l               on l.item_id = i.id
left join public.categories c  on c.id = i.category_id
left join public.locations loc on loc.id = i.default_location_id;

create view public.blood_stock_summary with (security_invoker = true) as
select g.lab_id, g.abo, g.rh, g.component,
       count(u.id) filter (where u.status = 'available' and u.expiry_date >= current_date) as available_units,
       count(u.id) filter (where u.status = 'quarantine')                                  as quarantine_units,
       count(u.id) filter (where u.status = 'reserved')                                    as reserved_units,
       count(u.id) filter (where u.status = 'available'
                           and u.expiry_date between current_date and current_date + 3)    as expiring_soon_units,
       coalesce(m.min_units, 0) as min_units,
       count(u.id) filter (where u.status = 'available' and u.expiry_date >= current_date)
         < coalesce(m.min_units, 0) as below_minimum
from (select lb.id as lab_id, a.abo, r.rh, c.component
      from public.labs lb
      cross join unnest(enum_range(null::public.abo_group)) a(abo)
      cross join unnest(enum_range(null::public.rh_factor)) r(rh)
      cross join unnest(enum_range(null::public.blood_component)) c(component)) g
left join public.blood_units u
       on u.lab_id = g.lab_id and u.abo = g.abo and u.rh = g.rh and u.component = g.component
left join public.blood_stock_minimums m
       on m.lab_id = g.lab_id and m.abo = g.abo and m.rh = g.rh and m.component = g.component
group by g.lab_id, g.abo, g.rh, g.component, m.min_units;

-- Cold storage: latest reading + whether a round is due
create view public.cold_storage_status with (security_invoker = true) as
select e.id, e.lab_id, e.name, e.asset_tag, e.temp_min_c, e.temp_max_c, e.readings_per_day, e.status,
       t.reading_c   as last_reading_c,
       t.recorded_at as last_recorded_at,
       t.out_of_range as last_out_of_range,
       (t.recorded_at is null
        or t.recorded_at < now() - make_interval(hours => (24 / e.readings_per_day))) as reading_due
from public.equipment e
left join lateral (
  select reading_c, recorded_at, out_of_range from public.temperature_logs tl
  where tl.equipment_id = e.id order by recorded_at desc limit 1
) t on true
where e.is_cold_storage and e.status <> 'retired';

-- Unified recent activity feed
create view public.activity_feed with (security_invoker = true) as
select m.id, m.lab_id, m.created_at, m.performed_by as actor_id, 'stock'::text as kind,
       m.type::text as action, i.name as subject, m.quantity_delta as qty, i.unit as unit,
       '/inventory/' || i.id as link
from public.stock_movements m join public.items i on i.id = m.item_id
union all
select ev.id, ev.lab_id, ev.created_at, ev.performed_by, 'blood',
       ev.to_status::text, u.unit_number || ' · ' || u.abo || case u.rh when 'pos' then '+' else '−' end,
       null, null, '/blood/' || u.id
from public.blood_unit_events ev join public.blood_units u on u.id = ev.unit_id
union all
select t.id, t.lab_id, t.completed_at, t.assignee_id, 'task', 'completed', t.title, null, null, '/tasks/' || t.id
from public.tasks t where t.status = 'completed' and t.completed_at is not null
union all
select tl.id, tl.lab_id, tl.recorded_at, tl.recorded_by, 'temperature',
       case when tl.out_of_range then 'out_of_range' else 'reading' end,
       e.name, tl.reading_c, '°C', '/equipment/' || e.id
from public.temperature_logs tl join public.equipment e on e.id = tl.equipment_id;

-- ---------- RLS ----------
do $$
declare t text;
begin
  foreach t in array array['labs','profiles','categories','locations','suppliers','items','stock_lots',
    'stock_movements','blood_units','blood_unit_events','blood_stock_minimums','equipment',
    'maintenance_logs','temperature_logs','tasks','task_checklist_items','task_comments',
    'notifications','audit_log']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Read: everyone in the lab sees shared lab data
create policy lab_read on public.labs for select to authenticated using (id = public.my_lab());
create policy lab_admin_update on public.labs for update to authenticated
  using (id = public.my_lab() and public.has_role('admin'))
  with check (id = public.my_lab() and public.has_role('admin'));

-- Profiles: see colleagues + yourself (even without a lab, so the app can show "not attached")
create policy profile_read on public.profiles for select to authenticated
  using (id = auth.uid() or (lab_id is not null and lab_id = public.my_lab()));
create policy profile_update on public.profiles for update to authenticated
  using (id = auth.uid() or (lab_id = public.my_lab() and public.has_role('admin')))
  with check (id = auth.uid() or (lab_id = public.my_lab() and public.has_role('admin')));

do $$
declare t text;
begin
  foreach t in array array['categories','locations','suppliers','items','stock_lots','stock_movements',
    'blood_units','blood_unit_events','blood_stock_minimums','equipment','maintenance_logs',
    'temperature_logs','tasks','task_checklist_items','task_comments']
  loop
    execute format('create policy lab_read on public.%I for select to authenticated using (lab_id = public.my_lab())', t);
  end loop;
end $$;

-- Inventory & reference lists: admin, supervisor, inventory officer
do $$
declare t text;
begin
  foreach t in array array['categories','locations','suppliers','items','stock_lots']
  loop
    execute format($f$create policy inv_write on public.%I for all to authenticated
      using (lab_id = public.my_lab() and public.has_role('admin','supervisor','inventory_officer'))
      with check (lab_id = public.my_lab() and public.has_role('admin','supervisor','inventory_officer'))$f$, t);
  end loop;
end $$;

-- Movements: inventory roles any type; staff may record usage only
create policy movement_insert on public.stock_movements for insert to authenticated
  with check (lab_id = public.my_lab() and (
    public.has_role('admin','supervisor','inventory_officer')
    or (public.has_role('staff') and type = 'consume')));

-- Blood bank
create policy blood_write on public.blood_units for all to authenticated
  using (lab_id = public.my_lab() and public.has_role('admin','supervisor','inventory_officer'))
  with check (lab_id = public.my_lab() and public.has_role('admin','supervisor','inventory_officer'));
create policy blood_min_write on public.blood_stock_minimums for all to authenticated
  using (lab_id = public.my_lab() and public.has_role('admin','supervisor'))
  with check (lab_id = public.my_lab() and public.has_role('admin','supervisor'));

-- Equipment
create policy equip_write on public.equipment for all to authenticated
  using (lab_id = public.my_lab() and public.has_role('admin','supervisor'))
  with check (lab_id = public.my_lab() and public.has_role('admin','supervisor'));
create policy maint_insert on public.maintenance_logs for insert to authenticated
  with check (lab_id = public.my_lab() and (
    public.has_role('admin','supervisor')
    or exists (select 1 from public.equipment e
               where e.id = equipment_id and e.assigned_technician_id = auth.uid())));
create policy temp_insert on public.temperature_logs for insert to authenticated
  with check (lab_id = public.my_lab());

-- Tasks
create policy task_insert on public.tasks for insert to authenticated
  with check (lab_id = public.my_lab() and (
    public.has_role('admin','supervisor') or assignee_id is null or assignee_id = auth.uid()));
create policy task_update on public.tasks for update to authenticated
  using (lab_id = public.my_lab() and (
    public.has_role('admin','supervisor') or assignee_id = auth.uid() or created_by = auth.uid()))
  with check (lab_id = public.my_lab() and (
    public.has_role('admin','supervisor') or assignee_id = auth.uid()
    or (created_by = auth.uid() and assignee_id is null)));
create policy task_delete on public.tasks for delete to authenticated
  using (lab_id = public.my_lab() and (public.has_role('admin','supervisor') or created_by = auth.uid()));

create policy checklist_write on public.task_checklist_items for all to authenticated
  using (lab_id = public.my_lab() and exists (select 1 from public.tasks t where t.id = task_id
         and (public.has_role('admin','supervisor') or t.assignee_id = auth.uid() or t.created_by = auth.uid())))
  with check (lab_id = public.my_lab() and exists (select 1 from public.tasks t where t.id = task_id
         and (public.has_role('admin','supervisor') or t.assignee_id = auth.uid() or t.created_by = auth.uid())));

create policy comment_insert on public.task_comments for insert to authenticated
  with check (lab_id = public.my_lab() and author_id = auth.uid());
create policy comment_delete on public.task_comments for delete to authenticated
  using (lab_id = public.my_lab() and (author_id = auth.uid() or public.has_role('admin')));

-- Notifications: own only (rows are created by database functions)
create policy notif_read   on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notif_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

-- Audit: lab admins only
create policy audit_read on public.audit_log for select to authenticated
  using (lab_id = public.my_lab() and public.has_role('admin'));
