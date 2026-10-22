-- Arquivos privados do Órbita em Supabase Storage (sem Google Drive).
alter table public.attachments add column if not exists storage_path text;

insert into storage.buckets (id,name,public,file_size_limit)
values ('orbita-files','orbita-files',false,26214400)
on conflict (id) do update set name=excluded.name,public=false,file_size_limit=excluded.file_size_limit;

drop policy if exists orbita_files_read on storage.objects;
create policy orbita_files_read on storage.objects for select to authenticated using (
  bucket_id='orbita-files' and (
    ((storage.foldername(name))[1]='channels' and exists (
      select 1 from public.channels c where c.id::text=(storage.foldername(name))[2] and c.kind='text'))
    or ((storage.foldername(name))[1]='conversations' and exists (
      select 1 from public.conversations c where c.id::text=(storage.foldername(name))[2]
      and (select auth.uid()) in (c.user_a,c.user_b)))
  )
);

drop policy if exists orbita_files_upload on storage.objects;
create policy orbita_files_upload on storage.objects for insert to authenticated with check (
  bucket_id='orbita-files' and (storage.foldername(name))[3]=(select auth.uid())::text and (
    ((storage.foldername(name))[1]='channels' and exists (
      select 1 from public.channels c where c.id::text=(storage.foldername(name))[2] and c.kind='text'))
    or ((storage.foldername(name))[1]='conversations' and exists (
      select 1 from public.conversations c where c.id::text=(storage.foldername(name))[2]
      and (select auth.uid()) in (c.user_a,c.user_b)))
  )
);

drop policy if exists orbita_files_delete_owner on storage.objects;
create policy orbita_files_delete_owner on storage.objects for delete to authenticated using (
  bucket_id='orbita-files' and (storage.foldername(name))[3]=(select auth.uid())::text and (
    ((storage.foldername(name))[1]='channels' and exists (
      select 1 from public.channels c where c.id::text=(storage.foldername(name))[2] and c.kind='text'))
    or ((storage.foldername(name))[1]='conversations' and exists (
      select 1 from public.conversations c where c.id::text=(storage.foldername(name))[2]
      and (select auth.uid()) in (c.user_a,c.user_b)))
  )
);

drop policy if exists attachment_scope_read on public.attachments;
create policy attachment_scope_read on public.attachments for select to authenticated using (
  (channel_id is not null and exists (select 1 from public.channels c where c.id=attachments.channel_id and c.kind='text'))
  or (conversation_id is not null and exists (select 1 from public.conversations c where c.id=attachments.conversation_id
    and (select auth.uid()) in (c.user_a,c.user_b)))
);

drop policy if exists attachment_scope_insert on public.attachments;
create policy attachment_scope_insert on public.attachments for insert to authenticated with check (
  owner_id=(select auth.uid()) and storage_path is not null and file_id=storage_path and storage_proof='supabase-private-v1'
  and (((channel_id is not null and conversation_id is null) and exists (
    select 1 from public.channels c where c.id=attachments.channel_id and c.kind='text'))
    or ((conversation_id is not null and channel_id is null) and exists (
      select 1 from public.conversations c where c.id=attachments.conversation_id and (select auth.uid()) in (c.user_a,c.user_b))))
);

drop policy if exists attachment_owner_delete on public.attachments;
create policy attachment_owner_delete on public.attachments for delete to authenticated using (owner_id=(select auth.uid()));


-- A tabela revoga permissões por padrão; conceder apenas as operações usadas com RLS.
grant select(storage_path) on public.attachments to authenticated;
grant insert(storage_path) on public.attachments to authenticated;
grant delete on public.attachments to authenticated;
