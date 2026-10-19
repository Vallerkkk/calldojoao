-- Execute no SQL Editor de um projeto Supabase novo.
-- Esta primeira versão tem UMA comunidade compartilhada por todas as contas cadastradas.
begin;
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 50)
);
create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null check (kind in ('text','voice')),
  position integer not null default 0
);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(trim(content)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists messages_channel_time on public.messages(channel_id, created_at desc);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), 'Participante'),50));
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();
insert into public.profiles(id, display_name)
select id, left(coalesce(nullif(trim(raw_user_meta_data->>'display_name'), ''),'Participante'),50)
from auth.users on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.channels enable row level security;
alter table public.messages enable row level security;
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);
drop policy if exists channels_read on public.channels;
create policy channels_read on public.channels for select to authenticated using (true);
drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated using (true);
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated with check (
  author_id = (select auth.uid()) and exists (
    select 1 from public.channels c where c.id = channel_id and c.kind = 'text'
  )
);
-- Não há permissões de alteração de canais, edição de perfis ou exclusão de mensagens no MVP.
revoke all on public.profiles, public.channels, public.messages from anon, authenticated;
grant select on public.profiles, public.channels, public.messages to authenticated;
grant insert (channel_id, author_id, content) on public.messages to authenticated;

insert into public.channels(name,kind,position) values
 ('geral','text',0),('projetos','text',1),('aleatório','text',2),
 ('Sala de estar','voice',3),('Foco & trabalho','voice',4)
on conflict (name) do nothing;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
commit;
