-- =====================================================================
-- LabSync v3 · 0005 storage (lab logos; files are stored under <lab_id>/...)
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('branding', 'branding', true, 1048576, array['image/png','image/jpeg','image/svg+xml','image/webp']),
  ('attachments', 'attachments', false, 10485760, null)
on conflict (id) do nothing;

create policy "branding admin write" on storage.objects for all to authenticated
  using (bucket_id = 'branding' and (storage.foldername(name))[1] = public.my_lab()::text and public.has_role('admin'))
  with check (bucket_id = 'branding' and (storage.foldername(name))[1] = public.my_lab()::text and public.has_role('admin'));

create policy "attachments lab read" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = public.my_lab()::text);
create policy "attachments lab upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = public.my_lab()::text);
create policy "attachments own delete" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = public.my_lab()::text
         and (owner_id = auth.uid()::text or public.has_role('admin')));
