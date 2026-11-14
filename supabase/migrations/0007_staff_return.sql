-- Staff may record usage and return unused stock (also powers "Undo" on a usage).
drop policy movement_insert on public.stock_movements;
create policy movement_insert on public.stock_movements for insert to authenticated
  with check (lab_id = public.my_lab() and (
    public.has_role('admin','supervisor','inventory_officer')
    or (public.has_role('staff') and type in ('consume','return'))));
