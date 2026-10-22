-- Permissões para o caminho privado de anexos; RLS limita cada operação ao escopo autorizado.
grant select(storage_path) on public.attachments to authenticated;
grant insert(storage_path) on public.attachments to authenticated;
grant delete on public.attachments to authenticated;
