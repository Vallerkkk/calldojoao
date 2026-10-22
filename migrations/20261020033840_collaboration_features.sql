-- Additive collaboration features. No existing conversations or files are removed.
alter table public.messages add column if not exists thread_root uuid references public.messages(id) on delete cascade;
alter table public.direct_messages add column if not exists thread_root uuid references public.direct_messages(id) on delete cascade;
alter table public.messages add column if not exists edited_at timestamptz;
alter table public.direct_messages add column if not exists edited_at timestamptz;
alter table public.channels add column if not exists is_stage boolean not null default false;
alter table public.messages add column if not exists search_vector tsvector generated always as (to_tsvector('portuguese'::regconfig,content)) stored;
alter table public.direct_messages add column if not exists search_vector tsvector generated always as (to_tsvector('portuguese'::regconfig,content)) stored;
create index if not exists messages_search_idx on public.messages using gin(search_vector);
create index if not exists direct_messages_search_idx on public.direct_messages using gin(search_vector);
create index if not exists messages_thread_idx on public.messages(thread_root,created_at,id) where thread_root is not null;
create index if not exists direct_messages_thread_idx on public.direct_messages(thread_root,created_at,id) where thread_root is not null;

create table if not exists public.community_moderation (
 community_id uuid not null references public.communities(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 banned boolean not null default false, timeout_until timestamptz,
 reason text not null default '' check(char_length(reason)<=500),
 updated_by uuid references public.profiles(id), updated_at timestamptz not null default now(),
 primary key(community_id,user_id)
);
create index if not exists community_moderation_user_idx on public.community_moderation(user_id);
create table if not exists public.audit_log (
 id bigint generated always as identity primary key,
 community_id uuid not null references public.communities(id) on delete cascade,
 actor_id uuid references public.profiles(id) on delete set null,
 target_id uuid references public.profiles(id) on delete set null,
 action text not null, reason text not null default '', details jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create index if not exists audit_log_community_idx on public.audit_log(community_id,created_at desc);
alter table public.community_moderation enable row level security;
alter table public.audit_log enable row level security;
grant select on public.community_moderation,public.audit_log to authenticated;
revoke insert,update,delete on public.community_moderation,public.audit_log from anon,authenticated;

create or replace function orbita_private.is_banned(community uuid, member uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.community_moderation where community_id=community and user_id=member and banned) $$;
revoke all on function orbita_private.is_banned(uuid,uuid) from public,anon;
grant execute on function orbita_private.is_banned(uuid,uuid) to authenticated;

create or replace function orbita_private.can_community(target uuid, permission_name text)
returns boolean language sql stable security definer set search_path=''
as $$ select auth.uid() is not null and not orbita_private.is_banned(target,auth.uid()) and (
 exists(select 1 from public.communities c where c.id=target and c.created_by=auth.uid())
 or exists(select 1 from public.site_roles r where r.user_id=auth.uid() and r.role in('creator','admin'))
 or exists(select 1 from public.community_member_roles mr join public.community_roles r on r.id=mr.role_id and r.community_id=mr.community_id where mr.community_id=target and mr.user_id=auth.uid() and permission_name=any(r.permissions))) $$;

create or replace function orbita_private.channel_access_for(member uuid,target uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select member is not null and not orbita_private.is_banned(c.community_id,member)
 and (not co.invite_only or exists(select 1 from public.community_members m where m.community_id=c.community_id and m.user_id=member))
 and (not c.is_private or co.created_by=member or exists(select 1 from public.site_roles r where r.user_id=member)
 or exists(select 1 from public.channel_members m where m.channel_id=c.id and m.user_id=member)
 or exists(select 1 from public.community_member_roles mr join public.community_roles r on r.id=mr.role_id and r.community_id=mr.community_id where mr.community_id=c.community_id and mr.user_id=member and 'manage_channels'=any(r.permissions)))
 from public.channels c join public.communities co on co.id=c.community_id where c.id=target $$;
revoke all on function orbita_private.channel_access_for(uuid,uuid) from public,anon,authenticated;

create or replace function orbita_private.can_read_channel(target uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select coalesce(orbita_private.channel_access_for(auth.uid(),target),false) $$;

create policy moderation_read on public.community_moderation for select to authenticated using(user_id=(select auth.uid()) or orbita_private.can_community(community_id,'manage_members'));
create policy audit_read on public.audit_log for select to authenticated using(orbita_private.can_community(community_id,'manage_members') or orbita_private.can_community(community_id,'manage_messages'));

create or replace function orbita_private.moderation_allowed(community uuid, member uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select orbita_private.can_community(community,'manage_members') and member<>auth.uid()
 and not exists(select 1 from public.site_roles where user_id=member)
 and not exists(select 1 from public.communities where id=community and created_by=member)
 and (exists(select 1 from public.site_roles where user_id=auth.uid()) or exists(select 1 from public.communities where id=community and created_by=auth.uid())
 or coalesce((select max(r.position) from public.community_member_roles mr join public.community_roles r on r.id=mr.role_id where mr.community_id=community and mr.user_id=auth.uid()),0)
 >coalesce((select max(r.position) from public.community_member_roles mr join public.community_roles r on r.id=mr.role_id where mr.community_id=community and mr.user_id=member),0)) $$;
revoke all on function orbita_private.moderation_allowed(uuid,uuid) from public,anon;
grant execute on function orbita_private.moderation_allowed(uuid,uuid) to authenticated;

create or replace function orbita_private.moderate_member(community uuid, member uuid, action_name text, reason_text text default '', duration_minutes integer default 10)
returns boolean language plpgsql security definer set search_path=''
as $$ begin
 if not orbita_private.moderation_allowed(community,member) then raise exception 'Sem permissão ou cargo de mesma hierarquia.'; end if;
 if action_name not in('timeout','untimeout','ban','unban') or char_length(reason_text)>500 or duration_minutes not between 1 and 40320 then raise exception 'Ação de moderação inválida.'; end if;
 insert into public.community_moderation(community_id,user_id,banned,timeout_until,reason,updated_by)
 values(community,member,action_name='ban',case when action_name='timeout' then now()+make_interval(mins=>duration_minutes) end,reason_text,auth.uid())
 on conflict(community_id,user_id) do update set
 banned=case when action_name='ban' then true when action_name='unban' then false else public.community_moderation.banned end,
 timeout_until=case when action_name='timeout' then now()+make_interval(mins=>duration_minutes) when action_name in('untimeout','unban') then null else public.community_moderation.timeout_until end,
 reason=reason_text,updated_by=auth.uid(),updated_at=now();
 insert into public.audit_log(community_id,actor_id,target_id,action,reason,details) values(community,auth.uid(),member,action_name,reason_text,jsonb_build_object('duration_minutes',duration_minutes));
 return true;
end $$;
revoke all on function orbita_private.moderate_member(uuid,uuid,text,text,integer) from public,anon;
grant execute on function orbita_private.moderate_member(uuid,uuid,text,text,integer) to authenticated;
create or replace function public.moderate_member(community uuid, member uuid, action_name text, reason_text text default '', duration_minutes integer default 10)
returns boolean language sql security invoker set search_path='' as $$ select orbita_private.moderate_member(community,member,action_name,reason_text,duration_minutes) $$;
revoke all on function public.moderate_member(uuid,uuid,text,text,integer) from public,anon;
grant execute on function public.moderate_member(uuid,uuid,text,text,integer) to authenticated;

create or replace function orbita_private.guard_message()
returns trigger language plpgsql security invoker set search_path=''
as $$ declare community uuid; parent_scope uuid; parent_root uuid; begin
 if tg_op='UPDATE' then
   if new.author_id<>old.author_id or new.created_at<>old.created_at or new.thread_root is distinct from old.thread_root then raise exception 'Autor e destino da mensagem são imutáveis.'; end if;
   if tg_table_name='messages' then
     if new.channel_id<>old.channel_id then raise exception 'Canal imutável.'; end if;
   else
     if new.conversation_id<>old.conversation_id then raise exception 'Conversa imutável.'; end if;
   end if;
   if new.content is distinct from old.content then
     if auth.uid() is distinct from old.author_id then raise exception 'Só o autor pode editar o conteúdo.'; end if;
     new.edited_at:=now();
   end if;
 end if;
 if tg_table_name='messages' then
   select community_id into community from public.channels where id=new.channel_id;
   if not orbita_private.can_read_channel(new.channel_id) or exists(select 1 from public.community_moderation where community_id=community and user_id=auth.uid() and (banned or timeout_until>now())) then raise exception 'Você está silenciado ou sem acesso a este servidor.'; end if;
 end if;
 if new.thread_root is not null then
   if tg_table_name='messages' then select channel_id,thread_root into parent_scope,parent_root from public.messages where id=new.thread_root;
     if parent_scope is distinct from new.channel_id then raise exception 'Thread fora do canal.'; end if;
   else select conversation_id,thread_root into parent_scope,parent_root from public.direct_messages where id=new.thread_root;
     if parent_scope is distinct from new.conversation_id then raise exception 'Thread fora da conversa.'; end if;
   end if;
   if parent_root is not null or new.id=new.thread_root then raise exception 'Thread inválida.'; end if;
 end if;
 return new;
end $$;
revoke all on function orbita_private.guard_message() from public,anon;
create trigger collaboration_guard before insert or update on public.messages for each row execute function orbita_private.guard_message();
create trigger collaboration_guard before insert or update on public.direct_messages for each row execute function orbita_private.guard_message();

create or replace function orbita_private.audit_message_delete()
returns trigger language plpgsql security definer set search_path=''
as $$ declare community uuid; begin
 select community_id into community from public.channels where id=old.channel_id;
 if community is not null and auth.uid() is not null then insert into public.audit_log(community_id,actor_id,target_id,action,details) values(community,auth.uid(),old.author_id,'delete_message',jsonb_build_object('message_id',old.id,'channel_id',old.channel_id)); end if;
 return old;
end $$;
revoke all on function orbita_private.audit_message_delete() from public,anon,authenticated;
create trigger collaboration_audit_delete after delete on public.messages for each row execute function orbita_private.audit_message_delete();

create table if not exists public.channel_speakers(channel_id uuid not null references public.channels(id) on delete cascade,user_id uuid not null references public.profiles(id) on delete cascade,primary key(channel_id,user_id));
alter table public.channel_speakers enable row level security;
grant select on public.channel_speakers to authenticated;
create policy stage_read on public.channel_speakers for select to authenticated using(orbita_private.can_read_channel(channel_id));
create or replace function orbita_private.call_permissions(target uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$ declare c public.channels; moderator boolean; blocked boolean; begin
 select * into c from public.channels where id=target and kind='voice';
 if not found or not orbita_private.can_read_channel(target) then raise exception 'Sala sem acesso.'; end if;
 moderator:=orbita_private.can_community(c.community_id,'manage_members');
 blocked:=exists(select 1 from public.community_moderation where community_id=c.community_id and user_id=auth.uid() and timeout_until>now());
 return jsonb_build_object('moderator',moderator,'stage',c.is_stage,'can_publish',not blocked and (not c.is_stage or moderator or exists(select 1 from public.channel_speakers where channel_id=target and user_id=auth.uid())));
end $$;
revoke all on function orbita_private.call_permissions(uuid) from public,anon;
grant execute on function orbita_private.call_permissions(uuid) to authenticated;
create or replace function public.call_permissions(target uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select orbita_private.call_permissions(target) $$;
revoke all on function public.call_permissions(uuid) from public,anon;
grant execute on function public.call_permissions(uuid) to authenticated;
create or replace function orbita_private.voice_authorize(target uuid,member uuid,action_name text)
returns boolean language plpgsql security definer set search_path=''
as $$ declare community uuid; begin
 select community_id into community from public.channels where id=target and kind='voice';
 if community is null or not orbita_private.moderation_allowed(community,member) or action_name not in('mute','speaker','audience','kick') then raise exception 'Sem permissão para gerenciar esta voz.';end if;
 if action_name='speaker' then
  if not orbita_private.channel_access_for(member,target) or exists(select 1 from public.community_moderation where community_id=community and user_id=member and timeout_until>now()) then raise exception 'Participante silenciado ou sem acesso.';end if;
  insert into public.channel_speakers values(target,member) on conflict do nothing;
 elsif action_name='audience' then delete from public.channel_speakers where channel_id=target and user_id=member;end if;
 insert into public.audit_log(community_id,actor_id,target_id,action,details)values(community,auth.uid(),member,'voice_'||action_name,jsonb_build_object('channel_id',target));return true;
end $$;
revoke all on function orbita_private.voice_authorize(uuid,uuid,text) from public,anon;
grant execute on function orbita_private.voice_authorize(uuid,uuid,text) to authenticated;
create or replace function public.voice_authorize(target uuid,member uuid,action_name text) returns boolean language sql security invoker set search_path='' as $$ select orbita_private.voice_authorize(target,member,action_name) $$;
revoke all on function public.voice_authorize(uuid,uuid,text) from public,anon;
grant execute on function public.voice_authorize(uuid,uuid,text) to authenticated;

create or replace function orbita_private.realtime_access(topic text, writing boolean default false)
returns boolean language plpgsql stable security definer set search_path=''
as $$ declare pieces text[]:=string_to_array(topic,':'); target uuid; begin
 if auth.uid() is null then return false;end if;
 if array_length(pieces,1)=2 and pieces[1]='user' then return not writing and pieces[2]=auth.uid()::text;end if;
 if array_length(pieces,1)<>3 or pieces[1]<>'orbita' then return false;end if;
 begin target:=pieces[3]::uuid; exception when invalid_text_representation then return false;end;
 if pieces[2]='channel' then return orbita_private.can_read_channel(target);
 elsif pieces[2]='direct' then return exists(select 1 from public.conversations where id=target and auth.uid() in(user_a,user_b));end if;
 return false;
end $$;
revoke all on function orbita_private.realtime_access(text,boolean) from public,anon;
grant execute on function orbita_private.realtime_access(text,boolean) to authenticated;
create policy collaboration_realtime_read on realtime.messages for select to authenticated using(orbita_private.realtime_access((select realtime.topic()),false));
create policy collaboration_realtime_write on realtime.messages for insert to authenticated with check(orbita_private.realtime_access((select realtime.topic()),true));

create table if not exists public.push_subscriptions(
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 endpoint text not null unique check(char_length(endpoint)<2000 and endpoint ~ '^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)/'),
 p256dh text not null check(char_length(p256dh) between 40 and 200 and p256dh ~ '^[A-Za-z0-9_-]+=*$'),
 auth text not null check(char_length(auth) between 16 and 100 and auth ~ '^[A-Za-z0-9_-]+=*$'), created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
grant select,insert,update,delete on public.push_subscriptions to authenticated;
create policy push_own on public.push_subscriptions for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create or replace function orbita_private.limit_push_subscriptions() returns trigger language plpgsql security definer set search_path='' as $$begin
 if (select count(*) from public.push_subscriptions where user_id=new.user_id)>=10 then raise exception 'Limite de dispositivos atingido.';end if;return new;end$$;
revoke all on function orbita_private.limit_push_subscriptions() from public,anon,authenticated;
create trigger push_subscription_limit before insert on public.push_subscriptions for each row execute function orbita_private.limit_push_subscriptions();
create table if not exists orbita_private.push_config(id boolean primary key default true check(id),transport_hash text not null);
create table if not exists orbita_private.push_jobs(id uuid primary key default gen_random_uuid(),author_id uuid not null references public.profiles(id) on delete cascade,recipient_id uuid not null references public.profiles(id) on delete cascade,payload jsonb not null,created_at timestamptz not null default now(),attempts int not null default 0,lease_until timestamptz,done boolean not null default false);
create index if not exists push_jobs_pending_idx on orbita_private.push_jobs(author_id,created_at) where not done;
alter table orbita_private.push_config enable row level security;
alter table orbita_private.push_jobs enable row level security;
revoke all on orbita_private.push_config,orbita_private.push_jobs from public,anon,authenticated;

create or replace function orbita_private.message_activity()
returns trigger language plpgsql security definer set search_path=''
as $$ declare recipient record; community uuid; destination text; mentioned boolean; note jsonb; begin
 if tg_table_name='messages' then select community_id into community from public.channels where id=new.channel_id;destination:='/?channel='||new.channel_id||'&message='||new.id;
 else destination:='/?dm='||new.conversation_id||'&message='||new.id;end if;
 for recipient in
  select p.id,p.username,p.presence_status from public.profiles p where p.id<>new.author_id and (
   (tg_table_name='messages' and exists(select 1 from public.community_members cm where cm.community_id=community and cm.user_id=p.id))
   or (tg_table_name='direct_messages' and exists(select 1 from public.conversations c where c.id=(to_jsonb(new)->>'conversation_id')::uuid and p.id in(c.user_a,c.user_b))))
 loop
  if tg_table_name='messages' then
   if not coalesce(orbita_private.channel_access_for(recipient.id,new.channel_id),false) then continue;end if;
  end if;
  mentioned:=tg_table_name='direct_messages' or lower(new.content) ~ ('(^|[^a-z0-9_])@'||lower(recipient.username)||'([^a-z0-9_]|$)');
  note:=jsonb_build_object('id',new.id,'author_id',new.author_id,'scope',coalesce(to_jsonb(new)->>'channel_id',to_jsonb(new)->>'conversation_id'),'private',tg_table_name='direct_messages','mentioned',mentioned,'thread_root',new.thread_root,'created_at',new.created_at);
  perform realtime.send(note,'activity','user:'||recipient.id,true);
  if mentioned and recipient.presence_status<>'dnd' and exists(select 1 from public.push_subscriptions where user_id=recipient.id) then
   insert into orbita_private.push_jobs(author_id,recipient_id,payload)values(new.author_id,recipient.id,jsonb_build_object('title',case when tg_table_name='direct_messages' then 'Nova mensagem privada · Órbita' else 'Você foi mencionado · Órbita' end,'body','Abra a Órbita para ler a mensagem.','url',destination,'tag','orbita-'||new.id));
  end if;
 end loop;return new;
end $$;
revoke all on function orbita_private.message_activity() from public,anon,authenticated;
create trigger collaboration_activity after insert on public.messages for each row execute function orbita_private.message_activity();
create trigger collaboration_activity after insert on public.direct_messages for each row execute function orbita_private.message_activity();

create or replace function orbita_private.push_take(transport_key text)
returns jsonb language plpgsql security definer set search_path=''
as $$ declare result jsonb; begin
 if auth.uid() is null or not exists(select 1 from orbita_private.push_config where transport_hash=encode(sha256(convert_to(transport_key,'UTF8')),'hex')) then raise exception 'Transporte não autorizado.';end if;
 delete from orbita_private.push_jobs where created_at<now()-interval '2 days';
 with jobs as (select id from orbita_private.push_jobs where author_id=auth.uid() and not done and attempts<3 and created_at>now()-interval '10 minutes' and (lease_until is null or lease_until<now()) order by created_at for update skip locked limit 50), leased as (update orbita_private.push_jobs j set attempts=attempts+1,lease_until=now()+interval '45 seconds' from jobs where j.id=jobs.id returning j.*)
 select coalesce(jsonb_agg(jsonb_build_object('job_id',j.id,'payload',j.payload,'subscription_id',s.id,'endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth)),'[]'::jsonb) into result from leased j join public.push_subscriptions s on s.user_id=j.recipient_id;
 return result;
end $$;
create or replace function orbita_private.push_finish(transport_key text,job uuid,expired uuid default null,success boolean default true)
returns boolean language plpgsql security definer set search_path=''
as $$ begin
 if auth.uid() is null or not exists(select 1 from orbita_private.push_config where transport_hash=encode(sha256(convert_to(transport_key,'UTF8')),'hex')) then raise exception 'Transporte não autorizado.';end if;
 if expired is not null then delete from public.push_subscriptions s using orbita_private.push_jobs j where j.id=job and j.author_id=auth.uid() and s.id=expired and s.user_id=j.recipient_id;end if;
 update orbita_private.push_jobs set done=success,lease_until=case when success then null else now()+interval '20 seconds' end where id=job and author_id=auth.uid();return true;
end $$;
revoke all on function orbita_private.push_take(text),orbita_private.push_finish(text,uuid,uuid,boolean) from public,anon;
grant execute on function orbita_private.push_take(text),orbita_private.push_finish(text,uuid,uuid,boolean) to authenticated;
create or replace function public.push_take(transport_key text) returns jsonb language sql security invoker set search_path='' as $$select orbita_private.push_take(transport_key)$$;
create or replace function public.push_finish(transport_key text,job uuid,expired uuid default null,success boolean default true) returns boolean language sql security invoker set search_path='' as $$select orbita_private.push_finish(transport_key,job,expired,success)$$;
revoke all on function public.push_take(text),public.push_finish(text,uuid,uuid,boolean) from public,anon;
grant execute on function public.push_take(text),public.push_finish(text,uuid,uuid,boolean) to authenticated;
notify pgrst,'reload schema';
