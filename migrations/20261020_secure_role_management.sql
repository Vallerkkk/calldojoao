-- Keep delegated role managers from granting themselves server ownership-level permissions.
create or replace function orbita_private.can_manage_roles(target uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select auth.uid() is not null and (
  exists(select 1 from public.communities c where c.id=target and c.created_by=(select auth.uid()))
  or exists(select 1 from public.site_roles s where s.user_id=(select auth.uid()) and s.role in('creator','admin'))
) $$;
grant execute on function orbita_private.can_manage_roles(uuid) to authenticated;
drop policy if exists community_roles_manage on public.community_roles;
create policy community_roles_manage on public.community_roles for all to authenticated
  using(orbita_private.can_manage_roles(community_id))
  with check(orbita_private.can_manage_roles(community_id));
drop policy if exists member_roles_manage on public.community_member_roles;
create policy member_roles_manage on public.community_member_roles for all to authenticated
  using(orbita_private.can_manage_roles(community_id))
  with check(orbita_private.can_manage_roles(community_id));
