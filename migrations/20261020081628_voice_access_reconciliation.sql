-- Recheck existing LiveKit participants against the same rules used when joining.
create or replace function orbita_private.voice_access_snapshot(target uuid, member_ids uuid[] default '{}', action_name text default 'sync')
returns jsonb language plpgsql stable security definer set search_path=''
as $$ declare c public.channels; allowed jsonb; begin
 select * into c from public.channels where id=target;
 if not found or auth.uid() is null or action_name not in('sync','close') then raise exception 'Canal indisponível.'; end if;
 if not (orbita_private.can_community(c.community_id,'manage_channels') or (action_name='sync' and
   (orbita_private.can_community(c.community_id,'manage_roles') or orbita_private.can_community(c.community_id,'manage_members')))) then
  raise exception 'Sem permissão para atualizar esta chamada.';
 end if;
 if cardinality(member_ids)>200 then raise exception 'Muitos participantes.';end if;
 select coalesce(jsonb_object_agg(m.id::text,not exists(select 1 from public.community_moderation x where x.community_id=c.community_id and x.user_id=m.id and x.timeout_until>now()) and
   (not c.is_stage or m.id=(select created_by from public.communities where id=c.community_id)
    or exists(select 1 from public.site_roles r where r.user_id=m.id and r.role in('creator','admin'))
    or exists(select 1 from public.community_member_roles mr join public.community_roles r on r.id=mr.role_id and r.community_id=mr.community_id where mr.community_id=c.community_id and mr.user_id=m.id and 'manage_members'=any(r.permissions))
    or exists(select 1 from public.channel_speakers s where s.channel_id=target and s.user_id=m.id))), '{}'::jsonb)
 into allowed from (select distinct unnest(member_ids) as id) m where orbita_private.channel_access_for(m.id,target);
 return jsonb_build_object('kind',c.kind,'participants',allowed);
end $$;
revoke all on function orbita_private.voice_access_snapshot(uuid,uuid[],text) from public,anon;
grant execute on function orbita_private.voice_access_snapshot(uuid,uuid[],text) to authenticated;
create or replace function public.voice_access_snapshot(target uuid,member_ids uuid[] default '{}',action_name text default 'sync')
returns jsonb language sql stable security invoker set search_path='' as $$ select orbita_private.voice_access_snapshot(target,member_ids,action_name) $$;
revoke all on function public.voice_access_snapshot(uuid,uuid[],text) from public,anon;
grant execute on function public.voice_access_snapshot(uuid,uuid[],text) to authenticated;
