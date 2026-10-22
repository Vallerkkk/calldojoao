-- Discord-style community access, roles, channels and profile media.
begin;

alter table public.profiles
  add column if not exists avatar_url text not null default '',
  add column if not exists banner_url text not null default '',
  add column if not exists pronouns text not null default '' check(char_length(pronouns)<=32),
  add column if not exists presence_activity text not null default '' check(char_length(presence_activity)<=80);
grant update(avatar_url,banner_url,pronouns,presence_activity) on public.profiles to authenticated;

alter table public.communities
  add column if not exists invite_only boolean not null default false;
grant update(invite_only) on public.communities to authenticated;

alter table public.channels
  add column if not exists is_private boolean not null default false,
  add column if not exists is_announcement boolean not null default false,
  add column if not exists default_for_new_members boolean not null default false;
grant insert(is_private,is_announcement,default_for_new_members),
  update(is_private,is_announcement,default_for_new_members) on public.channels to authenticated;
create unique index if not exists channels_one_default_text
  on public.channels(community_id) where default_for_new_members and kind='text';

create table if not exists public.community_members(
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key(community_id,user_id)
);
create index if not exists community_members_user on public.community_members(user_id,community_id);

create table if not exists public.community_roles(
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  name text not null check(char_length(trim(name)) between 1 and 32),
  color text not null default '#99aab5' check(color ~ '^#[0-9a-fA-F]{6}$'),
  position integer not null default 0,
  permissions text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique(community_id,name),
  unique(community_id,id),
  check(permissions <@ array['manage_channels','manage_roles','manage_messages','create_invite','manage_members']::text[])
);
create index if not exists community_roles_order on public.community_roles(community_id,position desc);

create table if not exists public.community_member_roles(
  community_id uuid not null,
  user_id uuid not null,
  role_id uuid not null,
  assigned_at timestamptz not null default now(),
  primary key(community_id,user_id,role_id),
  foreign key(community_id,user_id) references public.community_members(community_id,user_id) on delete cascade,
  foreign key(community_id,role_id) references public.community_roles(community_id,id) on delete cascade
);
create index if not exists community_member_roles_user on public.community_member_roles(community_id,user_id);

create table if not exists public.channel_members(
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key(channel_id,user_id)
);
create index if not exists channel_members_user on public.channel_members(user_id,channel_id);

create table if not exists public.community_invites(
  token_hash text primary key,
  community_id uuid not null references public.communities(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  expires_at timestamptz not null,
  max_uses integer not null default 100 check(max_uses between 1 and 500),
  uses integer not null default 0 check(uses>=0),
  created_at timestamptz not null default now()
);
create index if not exists community_invites_community on public.community_invites(community_id,expires_at);

create table if not exists public.community_emojis(
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  name text not null check(name ~ '^[a-z0-9_]{2,32}$'),
  storage_path text not null,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(community_id,name)
);

create schema if not exists orbita_private;
revoke all on schema orbita_private from public,anon;
grant usage on schema orbita_private to authenticated;

create or replace function orbita_private.is_community_member(target uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select auth.uid() is not null and exists(select 1 from public.community_members m where m.community_id=target and m.user_id=(select auth.uid())) $$;

create or replace function orbita_private.can_community(target uuid, permission_name text)
returns boolean language sql stable security definer set search_path=''
as $$
  select auth.uid() is not null and (
    exists(select 1 from public.communities c where c.id=target and c.created_by=(select auth.uid()))
    or exists(select 1 from public.site_roles r where r.user_id=(select auth.uid()) and r.role in('creator','admin'))
    or exists(select 1 from public.community_member_roles mr join public.community_roles r on r.id=mr.role_id and r.community_id=mr.community_id
      where mr.community_id=target and mr.user_id=(select auth.uid()) and permission_name=any(r.permissions))
  )
$$;

create or replace function orbita_private.can_read_channel(target uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select exists(select 1 from public.channels c where c.id=target
    and exists(select 1 from public.communities community where community.id=c.community_id
      and (not community.invite_only or orbita_private.is_community_member(c.community_id)))
    and (not c.is_private or orbita_private.can_community(c.community_id,'manage_channels')
      or exists(select 1 from public.channel_members cm where cm.channel_id=c.id and cm.user_id=(select auth.uid()))))
$$;

create or replace function orbita_private.add_community_owner()
returns trigger language plpgsql security definer set search_path=''
as $$ begin
  if new.created_by is not null then insert into public.community_members(community_id,user_id) values(new.id,new.created_by) on conflict do nothing; end if;
  return new;
end $$;
drop trigger if exists community_owner_membership on public.communities;
create trigger community_owner_membership after insert on public.communities for each row execute function orbita_private.add_community_owner();

create or replace function orbita_private.ensure_default_community()
returns uuid language plpgsql security definer set search_path=''
as $$ declare uid uuid:=(select auth.uid()); target uuid; begin
  if uid is null then raise exception 'Entre na sua conta.'; end if;
  select id into target from public.communities where is_default limit 1;
  if target is null then raise exception 'Comunidade padrão não encontrada.'; end if;
  insert into public.community_members(community_id,user_id) values(target,uid) on conflict do nothing;
  return target;
end $$;

create or replace function orbita_private.join_public_community(target uuid)
returns uuid language plpgsql security definer set search_path=''
as $$ declare uid uuid:=(select auth.uid()); begin
  if uid is null then raise exception 'Entre na sua conta.'; end if;
  if not exists(select 1 from public.communities where id=target and not invite_only) then raise exception 'Este servidor aceita apenas convites.'; end if;
  insert into public.community_members(community_id,user_id) values(target,uid) on conflict do nothing;
  return target;
end $$;

create or replace function orbita_private.create_community_invite(target uuid, expires_hours integer default 168, uses_limit integer default 100)
returns text language plpgsql security definer set search_path=''
as $$ declare uid uuid:=(select auth.uid()); token text; begin
  if uid is null or not orbita_private.can_community(target,'create_invite') then raise exception 'Sem permissão para criar convites.'; end if;
  if expires_hours not between 1 and 720 or uses_limit not between 1 and 500 then raise exception 'Prazo ou limite de usos inválido.'; end if;
  token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  insert into public.community_invites(token_hash,community_id,created_by,expires_at,max_uses)
    values(encode(sha256(convert_to(token,'UTF8')),'hex'),target,uid,now()+make_interval(hours=>expires_hours),uses_limit);
  return token;
end $$;

create or replace function orbita_private.join_community_invite(invitation text)
returns uuid language plpgsql security definer set search_path=''
as $$ declare uid uuid:=(select auth.uid()); invite public.community_invites; begin
  if uid is null then raise exception 'Entre na sua conta para aceitar o convite.'; end if;
  if invitation is null or char_length(invitation) not between 32 and 128 then raise exception 'Convite inválido ou expirado.'; end if;
  select * into invite from public.community_invites where token_hash=encode(sha256(convert_to(invitation,'UTF8')),'hex') for update;
  if not found or invite.expires_at<now() or invite.uses>=invite.max_uses then raise exception 'Convite inválido ou expirado.'; end if;
  insert into public.community_members(community_id,user_id) values(invite.community_id,uid) on conflict do nothing;
  update public.community_invites set uses=uses+1 where token_hash=invite.token_hash;
  return invite.community_id;
end $$;

create or replace function public.ensure_default_community()
returns uuid language sql security invoker set search_path=''
as $$ select orbita_private.ensure_default_community() $$;
create or replace function public.join_public_community(target uuid)
returns uuid language sql security invoker set search_path=''
as $$ select orbita_private.join_public_community(target) $$;
create or replace function public.create_community_invite(target uuid, expires_hours integer default 168, uses_limit integer default 100)
returns text language sql security invoker set search_path=''
as $$ select orbita_private.create_community_invite(target,expires_hours,uses_limit) $$;
create or replace function public.join_community_invite(invitation text)
returns uuid language sql security invoker set search_path=''
as $$ select orbita_private.join_community_invite(invitation) $$;

revoke all on function public.ensure_default_community() from public,anon;
revoke all on function public.join_public_community(uuid) from public,anon;
revoke all on function public.create_community_invite(uuid,integer,integer) from public,anon;
revoke all on function public.join_community_invite(text) from public,anon;
grant execute on function public.ensure_default_community() to authenticated;
grant execute on function public.join_public_community(uuid) to authenticated;
grant execute on function public.create_community_invite(uuid,integer,integer) to authenticated;
grant execute on function public.join_community_invite(text) to authenticated;
grant execute on function orbita_private.ensure_default_community(),orbita_private.join_public_community(uuid),orbita_private.create_community_invite(uuid,integer,integer),orbita_private.join_community_invite(text) to authenticated;
grant execute on function orbita_private.is_community_member(uuid),orbita_private.can_community(uuid,text),orbita_private.can_read_channel(uuid) to authenticated;

insert into public.community_members(community_id,user_id)
  select c.id,c.created_by from public.communities c where c.created_by is not null on conflict do nothing;

alter table public.community_members enable row level security;
alter table public.community_roles enable row level security;
alter table public.community_member_roles enable row level security;
alter table public.channel_members enable row level security;
alter table public.community_invites enable row level security;
alter table public.community_emojis enable row level security;
revoke all on public.community_members,public.community_roles,public.community_member_roles,public.channel_members,public.community_invites,public.community_emojis from public,anon,authenticated;
grant select on public.community_members,public.community_roles,public.community_member_roles,public.community_emojis to authenticated;
grant insert,update,delete on public.community_roles to authenticated;
grant insert,delete on public.community_member_roles to authenticated;
grant select,insert,delete on public.channel_members to authenticated;
grant select,insert,delete on public.community_emojis to authenticated;

drop policy if exists community_members_read on public.community_members;
create policy community_members_read on public.community_members for select to authenticated using(user_id=(select auth.uid()) or orbita_private.is_community_member(community_id) or orbita_private.can_community(community_id,'manage_members'));
drop policy if exists community_members_join_public on public.community_members;
create policy community_members_join_public on public.community_members for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.communities c where c.id=community_id and not c.invite_only));
drop policy if exists community_members_leave on public.community_members;
create policy community_members_leave on public.community_members for delete to authenticated using(user_id=(select auth.uid()) or orbita_private.can_community(community_id,'manage_members'));

drop policy if exists community_roles_read on public.community_roles;
create policy community_roles_read on public.community_roles for select to authenticated using(orbita_private.is_community_member(community_id));
drop policy if exists community_roles_manage on public.community_roles;
create policy community_roles_manage on public.community_roles for all to authenticated using(orbita_private.can_community(community_id,'manage_roles')) with check(orbita_private.can_community(community_id,'manage_roles'));

drop policy if exists member_roles_read on public.community_member_roles;
create policy member_roles_read on public.community_member_roles for select to authenticated using(orbita_private.is_community_member(community_id));
drop policy if exists member_roles_manage on public.community_member_roles;
create policy member_roles_manage on public.community_member_roles for all to authenticated using(orbita_private.can_community(community_id,'manage_roles')) with check(orbita_private.can_community(community_id,'manage_roles'));

drop policy if exists channel_members_read on public.channel_members;
create policy channel_members_read on public.channel_members for select to authenticated using(user_id=(select auth.uid()) or exists(select 1 from public.channels c where c.id=channel_id and orbita_private.can_community(c.community_id,'manage_channels')));
drop policy if exists channel_members_manage on public.channel_members;
create policy channel_members_manage on public.channel_members for insert to authenticated with check(exists(select 1 from public.channels c where c.id=channel_id and orbita_private.can_community(c.community_id,'manage_channels')));
drop policy if exists channel_members_remove on public.channel_members;
create policy channel_members_remove on public.channel_members for delete to authenticated using(user_id=(select auth.uid()) or exists(select 1 from public.channels c where c.id=channel_id and orbita_private.can_community(c.community_id,'manage_channels')));

drop policy if exists community_emojis_read on public.community_emojis;
create policy community_emojis_read on public.community_emojis for select to authenticated using(orbita_private.is_community_member(community_id));
drop policy if exists community_emojis_manage on public.community_emojis;
create policy community_emojis_manage on public.community_emojis for all to authenticated using(orbita_private.can_community(community_id,'manage_roles')) with check(orbita_private.can_community(community_id,'manage_roles') and created_by=(select auth.uid()));

drop policy if exists communities_read on public.communities;
create policy communities_read on public.communities for select to authenticated using(not invite_only or orbita_private.is_community_member(id) or orbita_private.can_community(id,'manage_channels'));
drop policy if exists channels_read on public.channels;
create policy channels_read on public.channels for select to authenticated using(orbita_private.can_read_channel(id));
drop policy if exists channels_create on public.channels;
create policy channels_create on public.channels for insert to authenticated with check(created_by=(select auth.uid()) and orbita_private.can_community(community_id,'manage_channels'));
drop policy if exists channels_manage on public.channels;
create policy channels_manage on public.channels for update to authenticated using(orbita_private.can_community(community_id,'manage_channels')) with check(orbita_private.can_community(community_id,'manage_channels'));
drop policy if exists channels_delete on public.channels;
create policy channels_delete on public.channels for delete to authenticated using(orbita_private.can_community(community_id,'manage_channels'));

drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated using(orbita_private.can_read_channel(channel_id));
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated with check(author_id=(select auth.uid()) and exists(select 1 from public.channels c where c.id=channel_id and c.kind='text' and orbita_private.can_read_channel(c.id) and (not c.is_announcement or orbita_private.can_community(c.community_id,'manage_messages'))) and (attachment_id is null or exists(select 1 from public.attachments a where a.id=attachment_id and a.owner_id=author_id and a.channel_id=messages.channel_id)));
drop policy if exists messages_own_edit on public.messages;
create policy messages_own_edit on public.messages for update to authenticated using(author_id=(select auth.uid()) or orbita_private.can_community((select community_id from public.channels where id=channel_id),'manage_messages')) with check(author_id=(select auth.uid()) or orbita_private.can_community((select community_id from public.channels where id=channel_id),'manage_messages'));
drop policy if exists messages_own_delete on public.messages;
create policy messages_own_delete on public.messages for delete to authenticated using(author_id=(select auth.uid()) or orbita_private.can_community((select community_id from public.channels where id=channel_id),'manage_messages'));

drop policy if exists attachment_scope_read on public.attachments;
create policy attachment_scope_read on public.attachments for select to authenticated using((channel_id is not null and orbita_private.can_read_channel(channel_id)) or (conversation_id is not null and exists(select 1 from public.conversations c where c.id=conversation_id and (select auth.uid()) in(c.user_a,c.user_b))));
drop policy if exists attachment_scope_insert on public.attachments;
create policy attachment_scope_insert on public.attachments for insert to authenticated with check(owner_id=(select auth.uid()) and storage_path is not null and file_id=storage_path and storage_proof='supabase-private-v1' and ((channel_id is not null and orbita_private.can_read_channel(channel_id)) or (conversation_id is not null and exists(select 1 from public.conversations c where c.id=conversation_id and (select auth.uid()) in(c.user_a,c.user_b)))));

drop policy if exists votes_read on public.poll_votes;
create policy votes_read on public.poll_votes for select to authenticated using((message_id is not null and exists(select 1 from public.messages m where m.id=message_id and orbita_private.can_read_channel(m.channel_id))) or (direct_message_id is not null and exists(select 1 from public.direct_messages d where d.id=direct_message_id and exists(select 1 from public.conversations c where c.id=d.conversation_id and (select auth.uid()) in(c.user_a,c.user_b)))));
drop policy if exists votes_insert on public.poll_votes;
create policy votes_insert on public.poll_votes for insert to authenticated with check(user_id=(select auth.uid()) and ((message_id is not null and exists(select 1 from public.messages m where m.id=message_id and m.poll is not null and option_index<jsonb_array_length(m.poll->'options') and orbita_private.can_read_channel(m.channel_id))) or (direct_message_id is not null and exists(select 1 from public.direct_messages d join public.conversations c on c.id=d.conversation_id where d.id=direct_message_id and d.poll is not null and option_index<jsonb_array_length(d.poll->'options') and (select auth.uid()) in(c.user_a,c.user_b)))));

alter table public.reactions drop constraint if exists reactions_emoji_check;
alter table public.reactions add constraint reactions_emoji_check check(emoji in('👍','❤️','😂','🎉','🔥','👀') or emoji ~ '^:[a-z0-9_]{2,32}:$');
drop policy if exists reaction_insert on public.reactions;
create policy reaction_insert on public.reactions for insert to authenticated with check(user_id=(select auth.uid()) and ((emoji not like ':%' and (exists(select 1 from public.messages m where m.id=message_id) or exists(select 1 from public.direct_messages d where d.id=direct_message_id))) or (emoji like ':%' and exists(select 1 from public.community_emojis e where ':'||e.name||':'=emoji and exists(select 1 from public.messages m join public.channels c on c.id=m.channel_id where m.id=message_id and c.community_id=e.community_id)))));

drop policy if exists orbita_files_read on storage.objects;
create policy orbita_files_read on storage.objects for select to authenticated using(
  bucket_id='orbita-files' and (
    ((storage.foldername(name))[1]='channels' and orbita_private.can_read_channel(((storage.foldername(name))[2])::uuid))
    or ((storage.foldername(name))[1]='conversations' and exists(select 1 from public.conversations c where c.id=((storage.foldername(name))[2])::uuid and (select auth.uid()) in(c.user_a,c.user_b)))
    or ((storage.foldername(name))[1]='profiles' and exists(select 1 from public.profiles p where p.id=((storage.foldername(name))[2])::uuid))
    or ((storage.foldername(name))[1]='community-assets' and exists(select 1 from public.community_emojis e where e.community_id=((storage.foldername(name))[2])::uuid and e.storage_path=name))
  )
);
drop policy if exists orbita_files_upload on storage.objects;
create policy orbita_files_upload on storage.objects for insert to authenticated with check(
  bucket_id='orbita-files' and (
    ((storage.foldername(name))[1]='channels' and (storage.foldername(name))[3]=(select auth.uid())::text and orbita_private.can_read_channel(((storage.foldername(name))[2])::uuid))
    or ((storage.foldername(name))[1]='conversations' and (storage.foldername(name))[3]=(select auth.uid())::text and exists(select 1 from public.conversations c where c.id=((storage.foldername(name))[2])::uuid and (select auth.uid()) in(c.user_a,c.user_b)))
    or ((storage.foldername(name))[1]='profiles' and (storage.foldername(name))[2]=(select auth.uid())::text)
    or ((storage.foldername(name))[1]='community-assets' and (storage.foldername(name))[3]=(select auth.uid())::text and orbita_private.can_community(((storage.foldername(name))[2])::uuid,'manage_roles'))
  )
);
drop policy if exists orbita_files_delete_owner on storage.objects;
create policy orbita_files_delete_owner on storage.objects for delete to authenticated using(
  bucket_id='orbita-files' and (
    ((storage.foldername(name))[1]='channels' and (storage.foldername(name))[3]=(select auth.uid())::text and orbita_private.can_read_channel(((storage.foldername(name))[2])::uuid))
    or ((storage.foldername(name))[1]='conversations' and (storage.foldername(name))[3]=(select auth.uid())::text and exists(select 1 from public.conversations c where c.id=((storage.foldername(name))[2])::uuid and (select auth.uid()) in(c.user_a,c.user_b)))
    or ((storage.foldername(name))[1]='profiles' and (storage.foldername(name))[2]=(select auth.uid())::text)
    or ((storage.foldername(name))[1]='community-assets' and (storage.foldername(name))[3]=(select auth.uid())::text and orbita_private.can_community(((storage.foldername(name))[2])::uuid,'manage_roles'))
  )
);

do $$ declare t text; begin
  foreach t in array array['community_members','community_roles','community_member_roles','channel_members','community_emojis'] loop
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end $$;

commit;

