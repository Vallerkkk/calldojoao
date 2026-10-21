create table public.message_reports(
 id uuid primary key default gen_random_uuid(),
 reporter_id uuid not null references public.profiles(id) on delete cascade,
 message_id uuid references public.messages(id) on delete set null,
 direct_message_id uuid references public.direct_messages(id) on delete set null,
 reason text not null check(char_length(trim(reason)) between 5 and 500),
 resolved boolean not null default false,
 created_at timestamptz not null default now(),
 check(message_id is null or direct_message_id is null)
);
create unique index message_reports_message on public.message_reports(reporter_id,message_id) where message_id is not null;
create unique index message_reports_direct on public.message_reports(reporter_id,direct_message_id) where direct_message_id is not null;
create index message_reports_message_fk on public.message_reports(message_id);
create index message_reports_direct_fk on public.message_reports(direct_message_id);
create index message_reports_pending on public.message_reports(resolved,created_at desc);
alter table public.message_reports enable row level security;
revoke all on public.message_reports from public,anon,authenticated;
grant select on public.message_reports to authenticated;
grant insert(reporter_id,message_id,direct_message_id,reason) on public.message_reports to authenticated;
grant update(resolved) on public.message_reports to authenticated;
create policy message_reports_create on public.message_reports for insert to authenticated with check(
 reporter_id=(select auth.uid()) and (
  (direct_message_id is null and exists(select 1 from public.messages m where m.id=message_id and m.author_id<>(select auth.uid())))
  or (message_id is null and exists(select 1 from public.direct_messages m where m.id=direct_message_id and m.author_id<>(select auth.uid())))
 )
);
create policy message_reports_read on public.message_reports for select to authenticated using(reporter_id=(select auth.uid()) or (select public.is_site_admin()));
create policy message_reports_resolve on public.message_reports for update to authenticated using((select public.is_site_admin())) with check((select public.is_site_admin()));
