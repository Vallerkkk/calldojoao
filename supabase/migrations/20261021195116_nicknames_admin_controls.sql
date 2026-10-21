-- Preserve custom existing handles. Replace only generated, unambiguous handles.
with candidates as (
 select id,lower(trim(display_name)) nick,count(*) over(partition by lower(trim(display_name))) copies
 from public.profiles where trim(display_name) ~ '^[A-Za-z0-9_]{3,24}$'
)
update public.profiles p set username=c.nick from candidates c
where p.id=c.id and p.username ~ '^orbiter_[a-f0-9]{12}$' and c.copies=1
and not exists(select 1 from public.profiles other where other.id<>p.id and lower(other.username)=c.nick);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path='' as $$
declare nickname text:=left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'),''),'Participante'),50);
begin
 -- Old clients can still register a display name; new clients supply a unique nickname.
 if nickname ~ '^[A-Za-z0-9_]{3,24}$' then
  insert into public.profiles(id,display_name,username)values(new.id,nickname,lower(nickname));
 else
  insert into public.profiles(id,display_name)values(new.id,nickname);
 end if;
 return new;
end $$;
revoke all on function public.handle_new_user() from public,anon,authenticated;

create or replace function orbita_private.unify_nickname() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.display_name is distinct from old.display_name or new.username is distinct from old.username then
  new.display_name:=trim(new.display_name);
  if new.display_name !~ '^[A-Za-z0-9_]{3,24}$' then
   raise exception 'Use um nickname de 3 a 24 letras, números ou _.' using errcode='23514';
  end if;
  new.username:=lower(new.display_name);
 end if;
 return new;
end $$;
revoke all on function orbita_private.unify_nickname() from public,anon,authenticated;
drop trigger if exists profiles_unify_nickname on public.profiles;
create trigger profiles_unify_nickname before update of display_name,username on public.profiles
for each row execute function orbita_private.unify_nickname();

create table public.site_admin_audit(
 id bigint generated always as identity primary key,
 actor_id uuid references public.profiles(id) on delete set null,
 target_id uuid references public.profiles(id) on delete set null,
 action text not null check(action in('grant_admin','revoke_admin')),
 created_at timestamptz not null default now()
);
create index site_admin_audit_recent on public.site_admin_audit(created_at desc);
create index site_admin_audit_actor on public.site_admin_audit(actor_id);
create index site_admin_audit_target on public.site_admin_audit(target_id);
alter table public.site_admin_audit enable row level security;
revoke all on public.site_admin_audit from public,anon,authenticated;
grant select on public.site_admin_audit to authenticated;
create policy site_admin_audit_read on public.site_admin_audit for select to authenticated
 using((select public.is_site_admin()));

create or replace function orbita_private.set_site_admin(member uuid,enabled boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); previous text;
begin
 if actor is null or not exists(select 1 from public.site_roles where user_id=actor and role='creator') then
  raise exception 'Somente um criador pode alterar os administradores.' using errcode='42501';
 end if;
 if member is null or enabled is null then raise exception 'Informe a pessoa e a ação.' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(721064512::bigint);
 -- Recheck the live role after obtaining the lock, never a user-editable JWT claim.
 perform 1 from public.site_roles where user_id=actor and role='creator' for update;
 if not found then raise exception 'Sem permissão.' using errcode='42501';end if;
 perform 1 from public.profiles where id=member;
 if not found then raise exception 'Conta não encontrada.' using errcode='22023';end if;
 select role into previous from public.site_roles where user_id=member for update;
 if previous='creator' then raise exception 'O cargo de criador está protegido.' using errcode='42501';end if;
 if enabled then
  if previous='admin' then return false;end if;
  insert into public.site_roles(user_id,role)values(member,'admin');
 else
  if previous is null then return false;end if;
  delete from public.site_roles where user_id=member and role='admin';
 end if;
 insert into public.site_admin_audit(actor_id,target_id,action)values(actor,member,case when enabled then 'grant_admin' else 'revoke_admin' end);
 return true;
end $$;
revoke all on function orbita_private.set_site_admin(uuid,boolean) from public,anon;
grant execute on function orbita_private.set_site_admin(uuid,boolean) to authenticated;
create or replace function public.set_site_admin(member uuid,enabled boolean) returns boolean
language sql security invoker set search_path='' as $$select orbita_private.set_site_admin(member,enabled)$$;
revoke all on function public.set_site_admin(uuid,boolean) from public,anon;
grant execute on function public.set_site_admin(uuid,boolean) to authenticated;
