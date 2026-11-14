-- Trigger functions are never called directly; role helpers only for signed-in users
revoke execute on function public.apply_maintenance(), public.apply_stock_movement(), public.audit_trigger(),
  public.check_temperature(), public.guard_blood_unit(), public.guard_profile(), public.log_blood_unit_event(),
  public.task_events() from public, anon, authenticated;
revoke execute on function public.my_lab(), public.my_role(), public.has_role(variadic public.app_role[]) from public, anon;
grant  execute on function public.my_lab(), public.my_role(), public.has_role(variadic public.app_role[]) to authenticated;
