-- Acquire legacy-table locks in one consistent order, or abort without waiting.
set local lock_timeout='2s';
set local statement_timeout='15s';
lock table public.profiles,public.communities,public.channels,public.messages,public.attachments,public.call_events,public.channel_members,public.direct_messages,public.reactions,public.music_state,orbita_private.creator_invites,public.community_invites,public.community_emojis,public.community_moderation,public.social_posts,public.social_follows,public.community_roles,public.community_member_roles in access exclusive mode nowait;
-- Social controls. Defaults preserve the visibility of existing accounts/posts.
create table public.social_privacy (
 user_id uuid primary key references public.profiles(id) on delete cascade default auth.uid(),
 private_account boolean not null default false,
 allow_dm text not null default 'friends' check(allow_dm in ('everyone','friends','nobody')),
 allow_mentions text not null default 'everyone' check(allow_mentions in ('everyone','following','nobody')),
 allow_comments text not null default 'everyone' check(allow_comments in ('everyone','following','nobody'))
);
alter table public.social_privacy enable row level security;
create policy social_privacy_read on public.social_privacy for select to authenticated using(true);
create policy social_privacy_write on public.social_privacy for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
grant select on public.social_privacy to authenticated;
grant insert(user_id,private_account,allow_dm,allow_mentions,allow_comments),update(private_account,allow_dm,allow_mentions,allow_comments) on public.social_privacy to authenticated;

create table public.social_follow_requests (
 follower_id uuid references public.profiles(id) on delete cascade default auth.uid(),
 following_id uuid references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),primary key(follower_id,following_id),check(follower_id<>following_id)
);
create index social_follow_requests_incoming on public.social_follow_requests(following_id,created_at desc);
alter table public.social_follow_requests enable row level security;
create policy follow_requests_read on public.social_follow_requests for select to authenticated using((select auth.uid()) in(follower_id,following_id));
create policy follow_requests_create on public.social_follow_requests for insert to authenticated with check(follower_id=(select auth.uid()) and orbita_private.social_visible(following_id));
create policy follow_requests_remove on public.social_follow_requests for delete to authenticated using((select auth.uid()) in(follower_id,following_id));
grant select,delete on public.social_follow_requests to authenticated;
grant insert(follower_id,following_id) on public.social_follow_requests to authenticated;

drop policy social_follows_add on public.social_follows;
create policy social_follows_add on public.social_follows for insert to authenticated with check(follower_id=(select auth.uid()) and orbita_private.social_visible(following_id)
 and not exists(select 1 from public.social_privacy p where p.user_id=following_id and p.private_account));
create function orbita_private.accept_follow(requester uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.social_follow_requests where follower_id=requester and following_id=auth.uid()) then raise exception 'Solicitação indisponível';end if;
 if not orbita_private.social_visible(requester) then raise exception 'Perfil indisponível';end if;
 insert into public.social_follows(follower_id,following_id)values(requester,auth.uid())on conflict do nothing;
 delete from public.social_follow_requests where follower_id=requester and following_id=auth.uid();
end $$;
create function public.accept_follow(requester uuid) returns void language sql security invoker set search_path='' as $$select orbita_private.accept_follow(requester)$$;
revoke all on function orbita_private.accept_follow(uuid),public.accept_follow(uuid) from public,anon;
grant execute on function orbita_private.accept_follow(uuid),public.accept_follow(uuid) to authenticated;

create table public.social_lists (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
 name text not null check(char_length(btrim(name)) between 1 and 40),unique(id,owner_id)
);
create table public.social_list_members (
 list_id uuid references public.social_lists(id) on delete cascade,user_id uuid references public.profiles(id) on delete cascade,primary key(list_id,user_id)
);
create index social_list_members_user on public.social_list_members(user_id,list_id);
alter table public.social_lists enable row level security;alter table public.social_list_members enable row level security;
create policy social_lists_own on public.social_lists for all to authenticated using(owner_id=(select auth.uid()))with check(owner_id=(select auth.uid()));
create policy social_list_members_own on public.social_list_members for all to authenticated using(exists(select 1 from public.social_lists l where l.id=list_id and l.owner_id=(select auth.uid())))with check(exists(select 1 from public.social_lists l where l.id=list_id and l.owner_id=(select auth.uid())));
grant select,delete on public.social_lists,public.social_list_members to authenticated;
grant insert(id,owner_id,name),update(name) on public.social_lists to authenticated;
grant insert(list_id,user_id) on public.social_list_members to authenticated;

create table public.social_mutes (
 user_id uuid references public.profiles(id) on delete cascade default auth.uid(),target_id uuid references public.profiles(id) on delete cascade,
 mode text not null default 'mute' check(mode in('mute','restrict')),primary key(user_id,target_id),check(user_id<>target_id)
);
create index social_mutes_target on public.social_mutes(target_id);
alter table public.social_mutes enable row level security;
create policy social_mutes_own on public.social_mutes for all to authenticated using(user_id=(select auth.uid()))with check(user_id=(select auth.uid()));
grant select,delete on public.social_mutes to authenticated;grant insert(user_id,target_id,mode),update(mode) on public.social_mutes to authenticated;

alter table public.social_posts add column audience text not null default 'public' check(audience in('public','followers','list'));
alter table public.social_posts add column list_id uuid references public.social_lists(id) on delete cascade;
alter table public.social_posts add constraint social_post_audience check((audience='list')=(list_id is not null));
create index social_posts_list on public.social_posts(list_id)where list_id is not null;
alter table public.social_posts drop constraint social_posts_content_check;
alter table public.social_posts add constraint social_posts_content_check check(char_length(content)<=10000);
grant insert(audience,list_id) on public.social_posts to authenticated;
create function orbita_private.social_post_visible(author uuid,audience text,list_key uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and orbita_private.social_visible(author) and (author=auth.uid() or (
 (not exists(select 1 from public.social_privacy p where p.user_id=author and p.private_account) or exists(select 1 from public.social_follows f where f.follower_id=auth.uid() and f.following_id=author))
 and (audience='public' or audience='followers' and exists(select 1 from public.social_follows f where f.follower_id=auth.uid() and f.following_id=author)
 or audience='list' and exists(select 1 from public.social_list_members m join public.social_lists l on l.id=m.list_id where m.list_id=list_key and m.user_id=auth.uid() and l.owner_id=author)))) $$;
revoke all on function orbita_private.social_post_visible(uuid,text,uuid) from public,anon;
grant execute on function orbita_private.social_post_visible(uuid,text,uuid) to authenticated;
drop policy social_posts_read on public.social_posts;
create policy social_posts_read on public.social_posts for select to authenticated using(orbita_private.social_post_visible(author_id,audience,list_id));
drop policy social_posts_insert on public.social_posts;
create policy social_posts_insert on public.social_posts for insert to authenticated with check(author_id=(select auth.uid()) and (list_id is null or exists(select 1 from public.social_lists l where l.id=list_id and l.owner_id=(select auth.uid()))));

create table public.social_pins (
 user_id uuid primary key references public.profiles(id) on delete cascade default auth.uid(),post_id uuid not null references public.social_posts(id) on delete cascade
);
create index social_pins_post on public.social_pins(post_id);
alter table public.social_pins enable row level security;
create policy social_pins_read on public.social_pins for select to authenticated using(exists(select 1 from public.social_posts p where p.id=post_id));
create policy social_pins_write on public.social_pins for all to authenticated using(user_id=(select auth.uid()))with check(user_id=(select auth.uid()) and exists(select 1 from public.social_posts p where p.id=post_id and p.author_id=(select auth.uid())));
grant select,delete on public.social_pins to authenticated;grant insert(user_id,post_id),update(post_id) on public.social_pins to authenticated;

create table public.social_polls (
 post_id uuid primary key references public.social_posts(id) on delete cascade,
 options text[] not null check(cardinality(options) between 2 and 6 and array_position(options,null) is null and length(array_to_string(options,''))<=600),
 closes_at timestamptz not null default now()+interval '1 day' check(closes_at>created_at and closes_at<=created_at+interval '30 days'),
 created_at timestamptz not null default now()
);
create table public.social_poll_votes (
 post_id uuid references public.social_polls(post_id) on delete cascade,user_id uuid references public.profiles(id) on delete cascade default auth.uid(),
 option_index integer not null check(option_index between 0 and 5),primary key(post_id,user_id)
);
create index social_poll_votes_user on public.social_poll_votes(user_id);
alter table public.social_polls enable row level security;alter table public.social_poll_votes enable row level security;
create policy social_polls_read on public.social_polls for select to authenticated using(exists(select 1 from public.social_posts p where p.id=post_id));
create policy social_polls_create on public.social_polls for insert to authenticated with check(exists(select 1 from public.social_posts p where p.id=post_id and p.author_id=(select auth.uid())));
create policy social_votes_read on public.social_poll_votes for select to authenticated using(exists(select 1 from public.social_polls p where p.post_id=social_poll_votes.post_id));
create policy social_votes_create on public.social_poll_votes for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.social_polls p where p.post_id=social_poll_votes.post_id and p.closes_at>now() and option_index<cardinality(p.options)));
grant select on public.social_polls,public.social_poll_votes to authenticated;
grant insert(post_id,options,closes_at) on public.social_polls to authenticated;grant insert(post_id,user_id,option_index) on public.social_poll_votes to authenticated;

create table public.social_stories (
 id uuid primary key default gen_random_uuid(),author_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
 caption text not null default '' check(char_length(caption)<=280),media_path text not null,
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '24 hours',
 highlighted boolean not null default false
);
create index social_stories_author on public.social_stories(author_id,created_at desc);create index social_stories_expiry on public.social_stories(expires_at);
alter table public.social_stories enable row level security;
create policy social_stories_read on public.social_stories for select to authenticated using(author_id=(select auth.uid()) or ((expires_at>now() or highlighted) and orbita_private.social_post_visible(author_id,'public',null)));
create policy social_stories_create on public.social_stories for insert to authenticated with check(author_id=(select auth.uid()) and media_path ~ ('^'||(select auth.uid())::text||'/'||id::text||'/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|gif|mp4|webm)$') and exists(select 1 from storage.objects o where o.bucket_id='orbita-feed' and o.name=media_path and coalesce((o.metadata->>'size')::bigint,5242881)<=5242880));
create policy social_stories_update on public.social_stories for update to authenticated using(author_id=(select auth.uid()))with check(author_id=(select auth.uid()));
create policy social_stories_delete on public.social_stories for delete to authenticated using(author_id=(select auth.uid()));
grant select,delete on public.social_stories to authenticated;grant insert(id,author_id,caption,media_path),update(highlighted) on public.social_stories to authenticated;
create policy social_story_media_read on storage.objects for select to authenticated using(bucket_id='orbita-feed' and exists(select 1 from public.social_stories s where s.media_path=name));

-- Interest roles never carry moderation permissions.
alter table public.community_roles add column self_assignable boolean not null default false;
alter table public.community_roles add constraint self_roles_safe check(not self_assignable or cardinality(permissions)=0);
create policy member_roles_self_add on public.community_member_roles for insert to authenticated with check(user_id=(select auth.uid()) and orbita_private.is_community_member(community_id) and exists(select 1 from public.community_roles r where r.id=role_id and r.community_id=community_member_roles.community_id and r.self_assignable and cardinality(r.permissions)=0));
create policy member_roles_self_remove on public.community_member_roles for delete to authenticated using(user_id=(select auth.uid()) and exists(select 1 from public.community_roles r where r.id=role_id and r.self_assignable and cardinality(r.permissions)=0));

create table public.community_welcome (
 community_id uuid primary key references public.communities(id) on delete cascade,
 rules text not null default '' check(char_length(rules)<=8000),version integer not null default 1 check(version>0),
 category text not null default 'Geral' check(char_length(category) between 1 and 40)
);
create table public.community_rule_acceptances (
 community_id uuid references public.communities(id) on delete cascade,user_id uuid references public.profiles(id) on delete cascade default auth.uid(),
 version integer not null,accepted_at timestamptz not null default now(),primary key(community_id,user_id)
);
create index community_rule_acceptances_user on public.community_rule_acceptances(user_id);
alter table public.community_welcome enable row level security;alter table public.community_rule_acceptances enable row level security;
create policy community_welcome_read on public.community_welcome for select to authenticated using(exists(select 1 from public.communities c where c.id=community_id));
create policy community_welcome_manage on public.community_welcome for all to authenticated using(orbita_private.can_community(community_id,'manage_channels'))with check(orbita_private.can_community(community_id,'manage_channels'));
create policy rule_acceptances_own on public.community_rule_acceptances for all to authenticated using(user_id=(select auth.uid()))with check(user_id=(select auth.uid()) and exists(select 1 from public.community_welcome w where w.community_id=community_rule_acceptances.community_id and w.version=community_rule_acceptances.version));
grant select,insert,update,delete on public.community_welcome to authenticated;grant select,delete on public.community_rule_acceptances to authenticated;grant insert(community_id,user_id,version),update(version) on public.community_rule_acceptances to authenticated;

create or replace function orbita_private.channel_access_for(member uuid,target uuid)
returns boolean language sql stable security definer set search_path='' as $$ select member is not null and not orbita_private.is_banned(c.community_id,member)
 and (not co.invite_only or exists(select 1 from public.community_members m where m.community_id=c.community_id and m.user_id=member))
 and (not exists(select 1 from public.community_welcome w where w.community_id=c.community_id and btrim(w.rules)<>'' and not exists(select 1 from public.community_rule_acceptances a where a.community_id=w.community_id and a.user_id=member and a.version=w.version)) or co.created_by=member or exists(select 1 from public.site_roles r where r.user_id=member))
 and (not c.is_private or co.created_by=member or exists(select 1 from public.site_roles r where r.user_id=member)
 or exists(select 1 from public.channel_members m where m.channel_id=c.id and m.user_id=member)
 or exists(select 1 from public.community_member_roles mr join public.community_roles r on r.id=mr.role_id and r.community_id=mr.community_id where mr.community_id=c.community_id and mr.user_id=member and 'manage_channels'=any(r.permissions)))
 from public.channels c join public.communities co on co.id=c.community_id where c.id=target $$;

create function orbita_private.discover_communities(term text) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) from (
 select c.id,c.name,c.description,coalesce(w.category,'Geral') category,
 (select count(*) from public.community_members m where m.community_id=c.id) members
 from public.communities c left join public.community_welcome w on w.community_id=c.id
 where auth.uid() is not null and not c.invite_only and not orbita_private.is_banned(c.id,auth.uid())
 and (term='' or strpos(lower(c.name||' '||c.description||' '||coalesce(w.category,'')),lower(left(term,80)))>0)
 order by c.name,c.id limit 50)c $$;
create function public.discover_communities(term text default '') returns jsonb language sql stable security invoker set search_path='' as $$select orbita_private.discover_communities(term)$$;
revoke all on function orbita_private.discover_communities(text),public.discover_communities(text) from public,anon;
grant execute on function orbita_private.discover_communities(text),public.discover_communities(text) to authenticated;

-- Per-device-independent preferences are private to the account.
create table public.notification_preferences (
 user_id uuid primary key references public.profiles(id) on delete cascade default auth.uid(),
 quiet_start time,quiet_end time,time_zone text not null default 'America/Sao_Paulo' check(char_length(time_zone)<=80),
 daily_digest boolean not null default false
);
create table public.channel_notification_preferences (
 user_id uuid references public.profiles(id) on delete cascade default auth.uid(),channel_id uuid references public.channels(id) on delete cascade,
 mode text not null default 'all' check(mode in('all','mentions','none')),primary key(user_id,channel_id)
);
create index channel_notification_preferences_channel on public.channel_notification_preferences(channel_id);
alter table public.notification_preferences enable row level security;alter table public.channel_notification_preferences enable row level security;
create policy notification_preferences_own on public.notification_preferences for all to authenticated using(user_id=(select auth.uid()))with check(user_id=(select auth.uid()));
create policy channel_notifications_own on public.channel_notification_preferences for all to authenticated using(user_id=(select auth.uid()))with check(user_id=(select auth.uid()) and orbita_private.can_read_channel(channel_id));
grant select,insert,update,delete on public.notification_preferences,public.channel_notification_preferences to authenticated;

create function orbita_private.welcome_version() returns trigger language plpgsql security invoker set search_path='' as $$begin if new.rules is distinct from old.rules then new.version:=old.version+1;else new.version:=old.version;end if;return new;end $$;
revoke all on function orbita_private.welcome_version() from public,anon,authenticated;
create trigger welcome_version before update on public.community_welcome for each row execute function orbita_private.welcome_version();
revoke insert,update on public.community_welcome from authenticated;
grant insert(community_id,rules,category),update(rules,category) on public.community_welcome to authenticated;

create function orbita_private.social_interaction_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare target_author uuid;mentions text;target_user uuid;preference text;begin
 if auth.uid() is null or new.author_id<>auth.uid() then raise exception 'Autor inválido';end if;
 if new.reply_to is not null then
  select author_id into target_author from public.social_posts where id=new.reply_to;
  select allow_comments into preference from public.social_privacy where user_id=target_author;
  if target_author<>auth.uid() and (preference='nobody' or preference='following' and not exists(select 1 from public.social_follows where follower_id=target_author and following_id=auth.uid())) then raise exception 'Este perfil limitou os comentários';end if;
  if exists(select 1 from public.social_mutes where user_id=target_author and target_id=auth.uid() and mode='restrict') then raise exception 'Comentários indisponíveis';end if;
 end if;
 for mentions in select distinct (m)[1] from regexp_matches(new.content,'@([A-Za-z0-9_]{3,24})','g') m loop
  select id into target_user from public.profiles where lower(username)=lower(mentions);
  select allow_mentions into preference from public.social_privacy where user_id=target_user;
  if target_user<>auth.uid() and (preference='nobody' or preference='following' and not exists(select 1 from public.social_follows where follower_id=target_user and following_id=auth.uid())) then raise exception 'Um perfil mencionado não permite essa marcação';end if;
 end loop;
 return new;
end $$;
revoke all on function orbita_private.social_interaction_guard() from public,anon,authenticated;
create trigger social_interactions before insert or update of content on public.social_posts for each row execute function orbita_private.social_interaction_guard();

create function public.social_ranked(kind text default 'foryou',page_offset integer default 0,search_text text default '') returns jsonb language sql stable security invoker set search_path='' as $$
 with candidates as (
 select p.id,p.author_id,p.created_at,
 ((select count(*) from public.social_likes l where l.post_id=p.id)*2+(select count(*) from public.social_reposts r where r.post_id=p.id)*3+(select count(*) from public.social_posts r where r.reply_to=p.id)*2+1)::float /
 power(2+extract(epoch from(now()-p.created_at))/3600,1.2) score
 from public.social_posts p where not p.is_reply and p.created_at>now()-case when kind='trending' then interval '1 day' else interval '30 days' end
 and not exists(select 1 from public.social_mutes m where m.user_id=auth.uid() and m.target_id=p.author_id)
 and (btrim(search_text)='' or strpos(lower(p.content),lower(left(search_text,100)))>0)
 order by p.created_at desc limit 1000
 ), ranked as (
 select c.*,row_number()over(partition by author_id order by score desc,id) author_position from candidates c
 ), page as (
 select r.*,case when kind='trending' then score else score/(1+(author_position-1)*0.8) end final_score from ranked r
 order by final_score desc,created_at desc,id desc limit 25 offset least(greatest(page_offset,0),975)
 )select coalesce(jsonb_agg((public.social_timeline('single',null,null,'',null,p.id)->0)||jsonb_build_object('rank_score',p.final_score)order by p.final_score desc,p.created_at desc,p.id desc),'[]'::jsonb)from page p $$;
revoke all on function public.social_ranked(text,integer,text) from public,anon;grant execute on function public.social_ranked(text,integer,text) to authenticated;

create function orbita_private.my_sessions() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'created_at',created_at,'updated_at',updated_at,'user_agent',left(user_agent,300),'current',id::text=auth.jwt()->>'session_id')order by updated_at desc),'[]'::jsonb)
 from auth.sessions where user_id=auth.uid() $$;
create function public.my_sessions()returns jsonb language sql stable security invoker set search_path=''as $$select orbita_private.my_sessions()$$;
revoke all on function orbita_private.my_sessions()from public,anon;grant execute on function orbita_private.my_sessions()to authenticated;
-- auth.sessions is not exposed. This read-only projection checks the caller's ID.
revoke all on function public.my_sessions() from public,anon;grant execute on function public.my_sessions() to authenticated;

create function public.export_my_data() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('exported_at',now(),'profile',(select to_jsonb(p)from public.profiles p where id=auth.uid()),
 'messages',coalesce((select jsonb_agg(to_jsonb(m))from public.messages m where author_id=auth.uid()),'[]'::jsonb),
 'direct_messages',coalesce((select jsonb_agg(to_jsonb(m))from public.direct_messages m where author_id=auth.uid()),'[]'::jsonb),
 'posts',coalesce((select jsonb_agg(to_jsonb(p))from public.social_posts p where author_id=auth.uid()),'[]'::jsonb),
 'stories',coalesce((select jsonb_agg(to_jsonb(s))from public.social_stories s where author_id=auth.uid()),'[]'::jsonb),
 'following',coalesce((select jsonb_agg(to_jsonb(f))from public.social_follows f where follower_id=auth.uid()),'[]'::jsonb),
 'lists',coalesce((select jsonb_agg(to_jsonb(l))from public.social_lists l where owner_id=auth.uid()),'[]'::jsonb),
 'list_members',coalesce((select jsonb_agg(to_jsonb(l))from public.social_list_members l),'[]'::jsonb),
 'privacy',(select to_jsonb(p)from public.social_privacy p where user_id=auth.uid()),
 'notifications',(select to_jsonb(p)from public.notification_preferences p where user_id=auth.uid()),
 'channel_notifications',coalesce((select jsonb_agg(to_jsonb(p))from public.channel_notification_preferences p where user_id=auth.uid()),'[]'::jsonb))where auth.uid() is not null $$;
revoke all on function public.export_my_data()from public,anon;grant execute on function public.export_my_data()to authenticated;

-- Explicit revokes also cover projects that inherited permissive default grants.
revoke all on public.social_privacy,public.social_follow_requests,public.social_lists,public.social_list_members,public.social_mutes,public.social_pins,public.social_polls,public.social_poll_votes,public.social_stories,public.community_welcome,public.community_rule_acceptances,public.notification_preferences,public.channel_notification_preferences from public,anon;

create function orbita_private.can_send_dm(sender uuid,recipient uuid)returns boolean language sql stable security definer set search_path=''as $$
 select sender=auth.uid() and sender<>recipient and orbita_private.social_visible(recipient) and case coalesce((select allow_dm from public.social_privacy where user_id=recipient),'friends')
 when 'nobody' then false when 'everyone' then true else exists(select 1 from public.friendships f where f.status='accepted' and least(f.requester_id,f.recipient_id)=least(sender,recipient) and greatest(f.requester_id,f.recipient_id)=greatest(sender,recipient))end $$;
revoke all on function orbita_private.can_send_dm(uuid,uuid)from public,anon;grant execute on function orbita_private.can_send_dm(uuid,uuid)to authenticated;
drop policy conversation_create on public.conversations;
create policy conversation_create on public.conversations for insert to authenticated with check(((select auth.uid())in(user_a,user_b))and orbita_private.can_send_dm((select auth.uid()),case when user_a=(select auth.uid())then user_b else user_a end));
drop policy direct_members_insert on public.direct_messages;
create policy direct_members_insert on public.direct_messages for insert to authenticated with check(author_id=(select auth.uid()) and exists(select 1 from public.conversations c where c.id=conversation_id and orbita_private.can_send_dm((select auth.uid()),case when c.user_a=(select auth.uid())then c.user_b else c.user_a end))and(attachment_id is null or exists(select 1 from public.attachments a where a.id=attachment_id and a.owner_id=author_id and a.conversation_id=direct_messages.conversation_id)));

create table public.social_reactions(post_id uuid references public.social_posts(id)on delete cascade,user_id uuid references public.profiles(id)on delete cascade default auth.uid(),emoji text not null check(emoji in('❤️','😂','🎉','🔥','👀','👍')),primary key(post_id,user_id));
create index social_reactions_user on public.social_reactions(user_id);
alter table public.social_reactions enable row level security;
create policy social_reactions_read on public.social_reactions for select to authenticated using(exists(select 1 from public.social_posts p where p.id=post_id));
create policy social_reactions_own on public.social_reactions for all to authenticated using(user_id=(select auth.uid()))with check(user_id=(select auth.uid())and exists(select 1 from public.social_posts p where p.id=post_id));
revoke all on public.social_reactions from public,anon,authenticated;grant select,delete on public.social_reactions to authenticated;grant insert(post_id,user_id,emoji),update(emoji)on public.social_reactions to authenticated;

create or replace function public.social_timeline(scope text default 'explore',before_at timestamptz default null,before_id uuid default null,search_text text default '',author_filter uuid default null,parent_filter uuid default null)
 returns jsonb language sql stable security invoker set search_path='' as $$
 with page as (
 select p.* from public.social_posts p where
 (case scope
 when 'thread' then p.reply_to=parent_filter
 when 'single' then p.id=parent_filter
 when 'profile' then p.author_id=author_filter
 when 'saved' then exists(select 1 from public.social_bookmarks b where b.post_id=p.id and b.user_id=auth.uid())
 when 'following' then not p.is_reply and (p.author_id=auth.uid() or exists(select 1 from public.social_follows f where f.follower_id=auth.uid() and f.following_id=p.author_id) or exists(select 1 from public.social_reposts r join public.social_follows f on f.following_id=r.user_id where r.post_id=p.id and f.follower_id=auth.uid()))
 else not p.is_reply end)
 and (scope in ('single','thread','profile') or not exists(select 1 from public.social_mutes m where m.user_id=auth.uid() and m.target_id=p.author_id))
 and (before_at is null or (p.created_at,p.id)<(before_at,before_id)or scope='profile'and exists(select 1 from public.social_pins pin where pin.post_id=p.id and pin.user_id=author_filter))
 and (btrim(search_text)='' or to_tsvector('simple',p.content) @@ websearch_to_tsquery('simple',left(search_text,100)) or p.content ilike '%'||replace(replace(left(search_text,100),'%','\%'),'_','\_')||'%')
 order by case when scope='profile'then exists(select 1 from public.social_pins pin where pin.post_id=p.id and pin.user_id=author_filter)else false end desc,p.created_at desc,p.id desc limit 25
 ) select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object(
 'pinned',exists(select 1 from public.social_pins pin where pin.post_id=p.id and pin.user_id=p.author_id),
 'reactions',coalesce((select jsonb_agg(jsonb_build_object('emoji',x.emoji,'count',x.total,'mine',x.mine))from(select emoji,count(*) total,bool_or(user_id=auth.uid())mine from public.social_reactions where post_id=p.id group by emoji)x),'[]'::jsonb),
 'poll',(select jsonb_build_object('options',poll.options,'closes_at',poll.closes_at,'votes',coalesce((select jsonb_agg(to_jsonb(v))from(select option_index,count(*)total from public.social_poll_votes where post_id=p.id group by option_index)v),'[]'::jsonb),'my_vote',(select option_index from public.social_poll_votes where post_id=p.id and user_id=auth.uid()))from public.social_polls poll where poll.post_id=p.id),
 'author',(select jsonb_build_object('id',u.id,'display_name',u.display_name,'username',u.username,'avatar_url',u.avatar_url,'avatar_color',u.avatar_color) from public.profiles u where u.id=p.author_id),
 'likes',(select count(*) from public.social_likes l where l.post_id=p.id),
 'reposts',(select count(*) from public.social_reposts r where r.post_id=p.id),
 'replies',(select count(*) from public.social_posts r where r.reply_to=p.id),
 'liked',exists(select 1 from public.social_likes l where l.post_id=p.id and l.user_id=auth.uid()),
 'reposted',exists(select 1 from public.social_reposts r where r.post_id=p.id and r.user_id=auth.uid()),
 'saved',exists(select 1 from public.social_bookmarks b where b.post_id=p.id and b.user_id=auth.uid()),
 'quote',(select jsonb_build_object('id',q.id,'content',q.content,'author',u.display_name) from public.social_posts q join public.profiles u on u.id=q.author_id where q.id=p.quote_id)
 ) order by p.created_at desc,p.id desc),'[]'::jsonb) from page p $$;


create or replace function public.social_people(search_text text default '',profile_id uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(u)||jsonb_build_object(
 'private_account',coalesce((select private_account from public.social_privacy where user_id=u.id),false),'requested',exists(select 1 from public.social_follow_requests where follower_id=auth.uid()and following_id=u.id),
 'followers',(select count(*) from public.social_follows where following_id=u.id),
 'following_count',(select count(*) from public.social_follows where follower_id=u.id),
 'following',exists(select 1 from public.social_follows where follower_id=auth.uid() and following_id=u.id))), '[]'::jsonb)
 from (select id,username,display_name,bio,avatar_color,avatar_url,banner_url,pronouns,custom_status from public.profiles where orbita_private.social_visible(id)
 and (profile_id is null or id=profile_id) and (search_text='' or strpos(lower(coalesce(username,'')||' '||display_name),lower(left(search_text,60)))>0)
 order by (id=auth.uid()),display_name,id limit 12) u $$;

alter table public.social_privacy add column public_profile boolean not null default false;
alter table public.social_privacy add column show_activity boolean not null default false;
grant insert(public_profile,show_activity),update(public_profile,show_activity)on public.social_privacy to authenticated;

create function orbita_private.public_profile(handle text)returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'bio',p.bio,'pronouns',p.pronouns,'avatar_color',p.avatar_color,
 'posts',coalesce((select jsonb_agg(to_jsonb(t))from(select sp.id,sp.content,sp.created_at from public.social_posts sp where sp.author_id=p.id and sp.audience='public'and not sp.is_reply order by exists(select 1 from public.social_pins pin where pin.post_id=sp.id and pin.user_id=p.id)desc,sp.created_at desc limit 10)t),'[]'::jsonb))
 from public.profiles p join public.social_privacy pref on pref.user_id=p.id where lower(p.username)=lower(left(handle,24))and pref.public_profile and not pref.private_account $$;
create function public.public_profile(handle text)returns jsonb language sql stable security invoker set search_path=''as $$select orbita_private.public_profile(handle)$$;
create function orbita_private.public_post(post_key uuid)returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object('id',p.id,'content',p.content,'created_at',p.created_at,'author',u.display_name,'username',u.username)
 from public.social_posts p join public.profiles u on u.id=p.author_id join public.social_privacy pref on pref.user_id=u.id
 where p.id=post_key and not p.is_reply and p.audience='public'and pref.public_profile and not pref.private_account $$;
create function public.public_post(post_key uuid)returns jsonb language sql stable security invoker set search_path=''as $$select orbita_private.public_post(post_key)$$;
revoke all on function orbita_private.public_profile(text),public.public_profile(text),orbita_private.public_post(uuid),public.public_post(uuid)from public;
grant usage on schema orbita_private to anon;
grant execute on function orbita_private.public_profile(text),public.public_profile(text),orbita_private.public_post(uuid),public.public_post(uuid)to anon,authenticated;

create table public.profile_activity(user_id uuid primary key references public.profiles(id)on delete cascade,last_seen timestamptz not null default now(),active_day date not null default current_date,streak integer not null default 1 check(streak between 1 and 100000));
alter table public.profile_activity enable row level security;
create policy profile_activity_read on public.profile_activity for select to authenticated using(user_id=(select auth.uid())or(exists(select 1 from public.social_privacy p where p.user_id=profile_activity.user_id and p.show_activity)and orbita_private.social_post_visible(user_id,'public',null)));
revoke all on public.profile_activity from public,anon,authenticated;grant select on public.profile_activity to authenticated;
create function orbita_private.touch_activity()returns void language plpgsql security definer set search_path=''as $$
declare today date:=(now()at time zone'UTC')::date;begin if auth.uid()is null then raise exception 'Entre na sua conta';end if;
 insert into public.profile_activity(user_id,active_day)values(auth.uid(),today)on conflict(user_id)do update set last_seen=now(),active_day=today,streak=case when profile_activity.active_day=today then profile_activity.streak when profile_activity.active_day=today-1 then least(profile_activity.streak+1,100000)else 1 end;end $$;
create function public.touch_activity()returns void language sql security invoker set search_path=''as $$select orbita_private.touch_activity()$$;
revoke all on function orbita_private.touch_activity(),public.touch_activity()from public,anon;grant execute on function orbita_private.touch_activity(),public.touch_activity()to authenticated;
create function orbita_private.profile_badges(target uuid)returns jsonb language sql stable security definer set search_path=''as $$
 select case when auth.uid()is not null and(target=auth.uid()or orbita_private.social_post_visible(target,'public',null))then
 to_jsonb(array_remove(array[
 case when(select created_at from auth.users where id=target)<now()-interval'1 year'then'Veterano'end,
 case when(select created_at from auth.users where id=target)<now()-interval'30 days'then'De casa'end,
 case when(select count(*)from public.messages where author_id=target)>=100 then'Boa conversa'end,
 case when(select count(*)from public.social_posts where author_id=target and not is_reply)>=10 then'Criador de ideias'end,
 case when(select count(*)from public.reactions r join public.messages m on m.id=r.message_id where m.author_id=target and r.user_id<>target)>=10 then'Ajuda reconhecida'end,
 case when(select coalesce(sum(uses),0)from public.community_invites where created_by=target)>=3 then'Conector'end,
 case when(select streak from public.profile_activity where user_id=target)>=7 then'7 dias em órbita'end],null))else'[]'::jsonb end $$;
create function public.profile_badges(target uuid)returns jsonb language sql stable security invoker set search_path=''as $$select orbita_private.profile_badges(target)$$;
revoke all on function orbita_private.profile_badges(uuid),public.profile_badges(uuid)from public,anon;grant execute on function orbita_private.profile_badges(uuid),public.profile_badges(uuid)to authenticated;

create table public.social_questions(id uuid primary key default gen_random_uuid(),recipient_id uuid not null references public.profiles(id)on delete cascade,author_id uuid not null default auth.uid()references public.profiles(id)on delete cascade,question text not null check(char_length(btrim(question))between 1 and 1000),answer text check(char_length(answer)<=2000),created_at timestamptz not null default now());
create index social_questions_recipient on public.social_questions(recipient_id,created_at desc);create index social_questions_author on public.social_questions(author_id);
alter table public.social_questions enable row level security;
create policy questions_read on public.social_questions for select to authenticated using((select auth.uid())in(author_id,recipient_id)or(answer is not null and orbita_private.social_post_visible(recipient_id,'public',null)));
create policy questions_create on public.social_questions for insert to authenticated with check(author_id=(select auth.uid())and author_id<>recipient_id and orbita_private.social_visible(recipient_id)and not exists(select 1 from public.social_privacy p where p.user_id=recipient_id and(p.allow_comments='nobody'or p.allow_comments='following'and not exists(select 1 from public.social_follows f where f.follower_id=recipient_id and f.following_id=(select auth.uid())))));
create policy questions_answer on public.social_questions for update to authenticated using(recipient_id=(select auth.uid()))with check(recipient_id=(select auth.uid()));
create policy questions_delete on public.social_questions for delete to authenticated using((select auth.uid())in(author_id,recipient_id));
revoke all on public.social_questions from public,anon,authenticated;grant select,delete on public.social_questions to authenticated;grant insert(recipient_id,author_id,question),update(answer)on public.social_questions to authenticated;

create table public.safety_reports(id uuid primary key default gen_random_uuid(),reporter_id uuid default auth.uid()references public.profiles(id)on delete set null,target_kind text not null check(target_kind in('post','profile','message','dm')),target_id uuid not null,reason text not null check(char_length(btrim(reason))between 5 and 500),snapshot text not null default'',media_paths text[]not null default'{}'check(cardinality(media_paths)<=4),created_at timestamptz not null default now(),resolution text check(char_length(resolution)between 5 and 1000),resolved_at timestamptz,resolved_by uuid references public.profiles(id)on delete set null,unique(reporter_id,target_kind,target_id));
create index safety_reports_pending on public.safety_reports(created_at)where resolved_at is null;create index safety_reports_resolver on public.safety_reports(resolved_by);
alter table public.safety_reports enable row level security;
create policy safety_reports_read on public.safety_reports for select to authenticated using(reporter_id=(select auth.uid())or(select public.is_site_admin()));
create policy safety_reports_create on public.safety_reports for insert to authenticated with check(reporter_id=(select auth.uid()));
create policy safety_reports_resolve on public.safety_reports for update to authenticated using((select public.is_site_admin()))with check((select public.is_site_admin()));
create function orbita_private.report_snapshot()returns trigger language plpgsql security invoker set search_path=''as $$begin
 if tg_op='INSERT'then
 case new.target_kind when'post'then select content,media into new.snapshot,new.media_paths from public.social_posts where id=new.target_id;
 when'profile'then select display_name||E'\n'||coalesce(bio,''),array_remove(array_remove(array[avatar_url,banner_url],null),'')into new.snapshot,new.media_paths from public.profiles where id=new.target_id;
 when'message'then select m.content,case when a.storage_path is null then'{}'::text[]else array[a.storage_path]end into new.snapshot,new.media_paths from public.messages m left join public.attachments a on a.id=m.attachment_id where m.id=new.target_id;
 when'dm'then select m.content,case when a.storage_path is null then'{}'::text[]else array[a.storage_path]end into new.snapshot,new.media_paths from public.direct_messages m left join public.attachments a on a.id=m.attachment_id where m.id=new.target_id;else raise exception'Alvo inválido';end case;
 if new.snapshot is null then raise exception'Conteúdo indisponível';end if;
 select coalesce(array_agg(path),'{}'::text[])into new.media_paths from unnest(new.media_paths)path where exists(select 1 from storage.objects o where o.name=path and o.bucket_id=case when new.target_kind='post'then'orbita-feed'else'orbita-files'end);
 new.snapshot:=left(new.snapshot,10000);
 else if not public.is_site_admin()then raise exception'Acesso negado';end if;new.resolved_by:=auth.uid();new.resolved_at:=now();end if;return new;end $$;
revoke all on function orbita_private.report_snapshot()from public,anon,authenticated;
create trigger report_snapshot before insert or update of resolution on public.safety_reports for each row execute function orbita_private.report_snapshot();
revoke all on public.safety_reports from public,anon,authenticated;grant select on public.safety_reports to authenticated;grant insert(reporter_id,target_kind,target_id,reason),update(resolution)on public.safety_reports to authenticated;

create table public.safety_decisions(id uuid primary key default gen_random_uuid(),report_id uuid not null references public.safety_reports(id),moderator_id uuid references public.profiles(id)on delete set null,resolution text not null,created_at timestamptz not null default now());
create index safety_decisions_report on public.safety_decisions(report_id);create index safety_decisions_moderator on public.safety_decisions(moderator_id);
alter table public.safety_decisions enable row level security;create policy safety_decisions_read on public.safety_decisions for select to authenticated using((select public.is_site_admin()));
revoke all on public.safety_decisions from public,anon,authenticated;grant select on public.safety_decisions to authenticated;
create function orbita_private.audit_safety_decision()returns trigger language plpgsql security definer set search_path=''as $$begin insert into public.safety_decisions(report_id,moderator_id,resolution)values(new.id,auth.uid(),new.resolution);return new;end $$;
revoke all on function orbita_private.audit_safety_decision()from public,anon,authenticated;
create trigger safety_decision after update of resolution on public.safety_reports for each row execute function orbita_private.audit_safety_decision();

-- Anonymous clients may call only the two explicit public projections.
revoke execute on all functions in schema orbita_private from public,anon;
grant execute on function orbita_private.public_profile(text),orbita_private.public_post(uuid)to anon;

-- Account deletion retains community content; ownership must be transferred first.
create function orbita_private.can_delete_account()returns jsonb language sql stable security definer set search_path=''as $$select jsonb_build_object('allowed',auth.uid()is not null and not exists(select 1 from public.communities where created_by=auth.uid())and not exists(select 1 from public.site_roles where user_id=auth.uid()and role='creator'), 'owned_communities',(select count(*)from public.communities where created_by=auth.uid()),'creator',exists(select 1 from public.site_roles where user_id=auth.uid()and role='creator'))$$;
create function public.can_delete_account()returns jsonb language sql stable security invoker set search_path=''as $$select orbita_private.can_delete_account()$$;
create function orbita_private.my_storage_paths()returns jsonb language sql stable security definer set search_path=''as $$select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket_id,'path',name)),'[]'::jsonb)from storage.objects where owner_id=auth.uid()::text and auth.uid()is not null$$;
create function public.my_storage_paths()returns jsonb language sql stable security invoker set search_path=''as $$select orbita_private.my_storage_paths()$$;
revoke all on function orbita_private.can_delete_account(),public.can_delete_account(),orbita_private.my_storage_paths(),public.my_storage_paths()from public,anon;
grant execute on function orbita_private.can_delete_account(),public.can_delete_account(),orbita_private.my_storage_paths(),public.my_storage_paths()to authenticated;
create function orbita_private.transfer_my_ownership(target uuid)returns void language plpgsql security definer set search_path=''as $$
declare uid uuid:=auth.uid();begin
 if uid is null or target=uid or not exists(select 1 from public.profiles where id=target)then raise exception'Destinatário inválido';end if;
 perform pg_advisory_xact_lock(hashtext('orbita-owner-transfer'));
 if exists(select 1 from public.communities c where c.created_by=uid and not exists(select 1 from public.community_members m where m.community_id=c.id and m.user_id=target))then raise exception'Escolha um membro de todas as comunidades que você criou';end if;
 if exists(select 1 from public.site_roles where user_id=uid and role='creator')then
  insert into public.site_roles(user_id,role)values(target,'creator')on conflict(user_id)do update set role='creator';
  delete from public.site_roles where user_id=uid;
 end if;
 update public.communities set created_by=target where created_by=uid;
 insert into public.ownership_transfers(actor_id,target_id)values(uid,target);
end $$;
create function public.transfer_my_ownership(target uuid)returns void language sql security invoker set search_path=''as $$select orbita_private.transfer_my_ownership(target)$$;
revoke all on function orbita_private.transfer_my_ownership(uuid),public.transfer_my_ownership(uuid)from public,anon;grant execute on function orbita_private.transfer_my_ownership(uuid),public.transfer_my_ownership(uuid)to authenticated;
create function orbita_private.protect_account_deletion()returns trigger language plpgsql security definer set search_path=''as $$begin
 if exists(select 1 from public.site_roles where user_id=old.id and role='creator')or exists(select 1 from public.communities where created_by=old.id)then raise exception'Transfira a propriedade das comunidades e da Órbita antes de excluir a conta';end if;return old;end $$;
revoke all on function orbita_private.protect_account_deletion()from public,anon,authenticated;
create trigger protect_account_deletion before delete on public.profiles for each row execute function orbita_private.protect_account_deletion();
-- Replace legacy no-action references with explicit, reviewed account-deletion rules.
do $$declare item record;mode text;begin
 for item in select c.conrelid::regclass relation,n.nspname||'.'||r.relname qualified_name,c.conname,a.attname column_name from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
 where c.contype='f'and c.confrelid='public.profiles'::regclass and c.confdeltype='a'and(n.nspname||'.'||r.relname,a.attname)in(('public.channels','created_by'),('public.call_events','caller_id'),('public.channel_members','added_by'),('public.attachments','owner_id'),('public.direct_messages','author_id'),('public.reactions','user_id'),('public.music_state','updated_by'),('orbita_private.creator_invites','claimed_by'),('public.community_invites','created_by'),('public.community_emojis','created_by'),('public.community_moderation','updated_by'))loop
 mode:=case when item.qualified_name in('public.channels','public.channel_members','public.music_state','orbita_private.creator_invites','public.community_moderation')then'SET NULL'else'CASCADE'end;
 if mode='SET NULL'then execute format('alter table %s alter column %I drop not null',item.relation,item.column_name);end if;
 execute format('alter table %s drop constraint %I',item.relation,item.conname);
 execute format('alter table %s add constraint %I foreign key(%I)references public.profiles(id)on delete %s',item.relation,item.conname,item.column_name,mode);
 end loop;end $$;
create table public.account_cleanup(user_id uuid primary key,paths jsonb not null,created_at timestamptz not null default now());
alter table public.account_cleanup enable row level security;revoke all on public.account_cleanup from public,anon,authenticated;grant select,insert,delete on public.account_cleanup to service_role;

create table public.channel_webhooks(id uuid primary key default gen_random_uuid(),channel_id uuid not null references public.channels(id)on delete cascade,name text not null check(char_length(btrim(name))between 1 and 40),created_by uuid not null default auth.uid()references public.profiles(id)on delete cascade,secret_hash text not null,created_at timestamptz not null default now(),window_start timestamptz not null default now(),window_count integer not null default 0);
create index channel_webhooks_channel on public.channel_webhooks(channel_id);create index channel_webhooks_creator on public.channel_webhooks(created_by);
alter table public.channel_webhooks enable row level security;
create policy webhooks_read on public.channel_webhooks for select to authenticated using(exists(select 1 from public.channels c where c.id=channel_id and orbita_private.can_community(c.community_id,'manage_channels')));
create policy webhooks_delete on public.channel_webhooks for delete to authenticated using(exists(select 1 from public.channels c where c.id=channel_id and orbita_private.can_community(c.community_id,'manage_channels')));
revoke all on public.channel_webhooks from public,anon,authenticated;
grant select(id,channel_id,name,created_by,created_at),delete on public.channel_webhooks to authenticated;
alter table public.messages add column webhook_id uuid references public.channel_webhooks(id)on delete set null;create index messages_webhook on public.messages(webhook_id)where webhook_id is not null;
create function orbita_private.create_channel_webhook(target uuid,label text)returns jsonb language plpgsql security definer set search_path=''as $$
declare channel public.channels;secret text:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');key uuid;begin
 perform pg_advisory_xact_lock(hashtext('webhook:'||target::text));
 select * into channel from public.channels where id=target;
 if auth.uid()is null or not found or channel.kind<>'text'or not orbita_private.can_community(channel.community_id,'manage_channels')or not orbita_private.can_read_channel(target)then raise exception'Acesso negado';end if;
 if(select count(*)from public.channel_webhooks where channel_id=target)>=5 then raise exception'Limite de 5 webhooks por canal';end if;
 insert into public.channel_webhooks(channel_id,name,created_by,secret_hash)values(target,left(btrim(label),40),auth.uid(),encode(sha256(convert_to(secret,'UTF8')),'hex'))returning id into key;
 return jsonb_build_object('id',key,'secret',secret);end $$;
create function public.create_channel_webhook(target uuid,label text)returns jsonb language sql security invoker set search_path=''as $$select orbita_private.create_channel_webhook(target,label)$$;
revoke all on function orbita_private.create_channel_webhook(uuid,text),public.create_channel_webhook(uuid,text)from public,anon;grant execute on function orbita_private.create_channel_webhook(uuid,text),public.create_channel_webhook(uuid,text)to authenticated;
create function orbita_private.ingest_webhook(hook_id uuid,secret text,content text)returns uuid language plpgsql security definer set search_path=''as $$
declare hook public.channel_webhooks;channel public.channels;key uuid;previous text:=current_setting('request.jwt.claim.sub',true);begin
 if char_length(secret)<>64 or char_length(btrim(content))not between 1 and 2000 then raise exception'Webhook inválido';end if;
 select * into hook from public.channel_webhooks where id=hook_id and secret_hash=encode(sha256(convert_to(secret,'UTF8')),'hex')for update;
 if not found then raise exception'Webhook inválido';end if;
 if hook.window_start>now()-interval'1 minute'and hook.window_count>=10 then raise exception'Webhook temporariamente limitado';end if;
 select * into channel from public.channels where id=hook.channel_id;
 perform set_config('request.jwt.claim.sub',hook.created_by::text,true);
 if not orbita_private.can_community(channel.community_id,'manage_channels')or not orbita_private.can_read_channel(channel.id)then raise exception'Webhook revogado';end if;
 update public.channel_webhooks set window_count=case when window_start>now()-interval'1 minute'then window_count+1 else 1 end,window_start=case when window_start>now()-interval'1 minute'then window_start else now()end where id=hook.id;
 insert into public.messages(channel_id,author_id,content,webhook_id)values(hook.channel_id,hook.created_by,'[Webhook · '||hook.name||'] '||replace(content,'@','＠'),hook.id)returning id into key;
 perform set_config('request.jwt.claim.sub',coalesce(previous,''),true);return key;end $$;
create function public.ingest_webhook(hook_id uuid,secret text,content text)returns uuid language sql security invoker set search_path=''as $$select orbita_private.ingest_webhook(hook_id,secret,content)$$;
revoke all on function orbita_private.ingest_webhook(uuid,text,text),public.ingest_webhook(uuid,text,text)from public,anon,authenticated;grant execute on function orbita_private.ingest_webhook(uuid,text,text),public.ingest_webhook(uuid,text,text)to service_role;

grant usage on schema orbita_private to service_role;

-- PostgREST upserts include key columns. RLS checks both old and new ownership.
grant update(user_id)on public.social_privacy,public.social_pins to authenticated;
grant update(user_id,target_id)on public.social_mutes to authenticated;
grant update(post_id,user_id)on public.social_reactions to authenticated;
grant update(community_id,user_id)on public.community_rule_acceptances to authenticated;
create table public.ownership_transfers(id uuid primary key default gen_random_uuid(),actor_id uuid references public.profiles(id)on delete set null,target_id uuid references public.profiles(id)on delete set null,created_at timestamptz not null default now());
create index ownership_transfers_actor on public.ownership_transfers(actor_id);create index ownership_transfers_target on public.ownership_transfers(target_id);
alter table public.ownership_transfers enable row level security;create policy ownership_transfers_read on public.ownership_transfers for select to authenticated using((select public.is_site_admin()));revoke all on public.ownership_transfers from public,anon,authenticated;grant select on public.ownership_transfers to authenticated;

create function orbita_private.social_parent_visible(parent uuid)returns boolean language sql stable security definer set search_path=''as $$
 with recursive chain as(select p.id,p.author_id,p.audience,p.list_id,p.reply_to,1 depth from public.social_posts p where p.id=parent
 union all select p.id,p.author_id,p.audience,p.list_id,p.reply_to,c.depth+1 from public.social_posts p join chain c on p.id=c.reply_to where c.depth<32)
 select parent is null or(exists(select 1 from chain)and not exists(select 1 from chain where not orbita_private.social_post_visible(author_id,audience,list_id)or(depth=32 and reply_to is not null))) $$;
revoke all on function orbita_private.social_parent_visible(uuid)from public,anon;grant execute on function orbita_private.social_parent_visible(uuid)to authenticated;
drop policy social_posts_read on public.social_posts;
create policy social_posts_read on public.social_posts for select to authenticated using(orbita_private.social_post_visible(author_id,audience,list_id)and(author_id=(select auth.uid())or((not is_reply or reply_to is not null)and orbita_private.social_parent_visible(reply_to))));
create function orbita_private.story_limits()returns trigger language plpgsql security invoker set search_path=''as $$begin
 perform pg_advisory_xact_lock(hashtext('story:'||auth.uid()::text));
 if tg_op='INSERT'and(select count(*)from public.social_stories where author_id=auth.uid())>=20 then raise exception'Limite de 20 stories armazenados. Apague alguns antes de publicar';end if;
 if new.highlighted and(tg_op='INSERT'or not old.highlighted)and(select count(*)from public.social_stories where author_id=auth.uid()and highlighted)>=10 then raise exception'Limite de 10 destaques';end if;return new;end $$;
revoke all on function orbita_private.story_limits()from public,anon,authenticated;create trigger story_limits before insert or update on public.social_stories for each row execute function orbita_private.story_limits();

-- A cascading account deletion must not recreate audit references to the deleted profile.
create or replace function orbita_private.audit_message_delete()returns trigger language plpgsql security definer set search_path=''as $$declare community uuid;begin
 if not exists(select 1 from public.profiles where id=old.author_id)or not exists(select 1 from public.profiles where id=auth.uid())then return old;end if;
 select community_id into community from public.channels where id=old.channel_id;
 if community is not null then insert into public.audit_log(community_id,actor_id,target_id,action,details)values(community,auth.uid(),old.author_id,'delete_message',jsonb_build_object('message_id',old.id,'channel_id',old.channel_id));end if;return old;end $$;

create function public.social_search(term text)returns jsonb language sql stable security invoker set search_path=''as $$
 select jsonb_build_object('people',public.social_people(left(term,60),null),'posts',public.social_timeline('explore',null,null,left(term,100),null,null),'communities',public.discover_communities(left(term,80)),
 'hashtags',coalesce((select jsonb_agg(to_jsonb(h))from(select lower((m)[1])tag,count(*)uses from(select content from public.social_posts order by created_at desc limit 2000)p cross join lateral regexp_matches(p.content,'#([[:alnum:]_]{2,40})','g')m where strpos(lower((m)[1]),lower(replace(left(term,40),'#','')))>0 group by lower((m)[1])order by count(*)desc limit 12)h),'[]'::jsonb)) $$;
revoke all on function public.social_search(text)from public,anon;grant execute on function public.social_search(text)to authenticated;
create function orbita_private.social_suggestions()returns jsonb language sql stable security definer set search_path=''as $$
 with mine as(select case when requester_id=auth.uid()then recipient_id else requester_id end id from public.friendships where status='accepted'and auth.uid()in(requester_id,recipient_id)),
 scored as(select p.id,p.display_name,p.username,
 (select count(*)from public.community_members a join public.community_members b on b.community_id=a.community_id where a.user_id=auth.uid()and b.user_id=p.id) common_communities,
 (select count(*)from public.community_member_roles a join public.community_member_roles b on b.community_id=a.community_id and b.role_id=a.role_id where a.user_id=auth.uid()and b.user_id=p.id) common_interests,
 (select count(*)from mine m where exists(select 1 from public.friendships f where f.status='accepted'and least(f.requester_id,f.recipient_id)=least(p.id,m.id)and greatest(f.requester_id,f.recipient_id)=greatest(p.id,m.id)))common_friends
 from public.profiles p where auth.uid()is not null and p.id<>auth.uid()and orbita_private.social_visible(p.id)
 and not exists(select 1 from public.social_follows where follower_id=auth.uid()and following_id=p.id)
 and not exists(select 1 from public.social_mutes where user_id=auth.uid()and target_id=p.id))
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb)from(select * from scored order by common_communities*2+common_friends*3+common_interests*2 desc,display_name,id limit 12)t $$;
create function public.social_suggestions()returns jsonb language sql stable security invoker set search_path=''as $$select orbita_private.social_suggestions()$$;
revoke all on function orbita_private.social_suggestions(),public.social_suggestions()from public,anon;grant execute on function orbita_private.social_suggestions(),public.social_suggestions()to authenticated;

create or replace function public.social_ranked(kind text default 'foryou',page_offset integer default 0,search_text text default '') returns jsonb language sql stable security invoker set search_path='' as $$
 with candidates as (
 select p.id,p.author_id,p.created_at,
 ((select count(*) from public.social_likes l where l.post_id=p.id)*2+(select count(*)from public.social_reactions r where r.post_id=p.id)*2+(select count(*) from public.social_reposts r where r.post_id=p.id)*3+(select count(*) from public.social_posts r where r.reply_to=p.id)*2+1)::float /
 power(2+extract(epoch from(now()-p.created_at))/3600,1.2) score
 from public.social_posts p where not p.is_reply and p.created_at>now()-case when kind='trending' then interval '1 day' else interval '30 days' end
 and not exists(select 1 from public.social_mutes m where m.user_id=auth.uid() and m.target_id=p.author_id)
 and (btrim(search_text)='' or strpos(lower(p.content),lower(left(search_text,100)))>0)
 order by p.created_at desc limit 1000
 ), ranked as (
 select c.*,row_number()over(partition by author_id order by score desc,id) author_position from candidates c
 ), page as (
 select r.*,case when kind='trending' then score else score/(1+(author_position-1)*0.8) end final_score from ranked r
 order by final_score desc,created_at desc,id desc limit 25 offset least(greatest(page_offset,0),1000)
 )select coalesce(jsonb_agg((public.social_timeline('single',null,null,'',null,p.id)->0)||jsonb_build_object('rank_score',p.final_score)order by p.final_score desc,p.created_at desc,p.id desc),'[]'::jsonb)from page p $$;

create table public.community_follows(user_id uuid references public.profiles(id)on delete cascade default auth.uid(),community_id uuid references public.communities(id)on delete cascade,created_at timestamptz not null default now(),primary key(user_id,community_id));
create index community_follows_community on public.community_follows(community_id,created_at);
alter table public.community_follows enable row level security;create policy community_follows_own on public.community_follows for all to authenticated using(user_id=(select auth.uid()))with check(user_id=(select auth.uid())and exists(select 1 from public.communities c where c.id=community_id));
revoke all on public.community_follows from public,anon,authenticated;grant select,delete on public.community_follows to authenticated;grant insert(user_id,community_id)on public.community_follows to authenticated;

create table public.digest_deliveries(user_id uuid references public.profiles(id)on delete cascade,day date not null default current_date,status text not null default'reserved'check(status in('reserved','sent','failed')),primary key(user_id,day));
alter table public.digest_deliveries enable row level security;revoke all on public.digest_deliveries from public,anon,authenticated;grant select,insert,update on public.digest_deliveries to service_role;grant select on public.notification_preferences to service_role;
create function orbita_private.reserve_digest(target uuid)returns boolean language plpgsql security definer set search_path=''as $$declare changed integer;begin
 perform pg_advisory_xact_lock(hashtext('orbita-digest-budget'));
 if not exists(select 1 from public.notification_preferences where user_id=target and daily_digest)or(select count(*)from public.digest_deliveries where day=current_date)>=50 or(select count(*)from public.digest_deliveries where day>=date_trunc('month',now())::date)>=1500 then return false;end if;
 insert into public.digest_deliveries(user_id)values(target)on conflict do nothing;get diagnostics changed=row_count;return changed=1;end $$;
create function public.reserve_digest(target uuid)returns boolean language sql security invoker set search_path=''as $$select orbita_private.reserve_digest(target)$$;
create function orbita_private.digest_counts(target uuid)returns jsonb language sql stable security definer set search_path=''as $$select jsonb_build_object('likes',(select count(*)from public.social_likes l join public.social_posts p on p.id=l.post_id where p.author_id=target and l.created_at>now()-interval'1 day'), 'replies',(select count(*)from public.social_posts r join public.social_posts p on p.id=r.reply_to where p.author_id=target and r.author_id<>target and r.created_at>now()-interval'1 day'), 'messages',(select count(*)from public.direct_messages d join public.conversations c on c.id=d.conversation_id where target in(c.user_a,c.user_b)and d.author_id<>target and d.created_at>now()-interval'1 day'))$$;
create function public.digest_counts(target uuid)returns jsonb language sql stable security invoker set search_path=''as $$select orbita_private.digest_counts(target)$$;
revoke all on function orbita_private.reserve_digest(uuid),public.reserve_digest(uuid),orbita_private.digest_counts(uuid),public.digest_counts(uuid)from public,anon,authenticated;
grant execute on function orbita_private.reserve_digest(uuid),public.reserve_digest(uuid),orbita_private.digest_counts(uuid),public.digest_counts(uuid)to service_role;

-- OAuth providers need a collision-free handle until the member chooses a nickname.
create or replace function public.handle_new_user()returns trigger language plpgsql security definer set search_path=''as $$declare nickname text:=trim(coalesce(new.raw_user_meta_data->>'display_name',''));begin
 if new.raw_app_meta_data->>'provider'in('google','discord')or nickname !~ '^[A-Za-z0-9_]{3,24}$'then nickname:='orbiter_'||substr(replace(new.id::text,'-',''),1,12);end if;
 insert into public.profiles(id,display_name,username)values(new.id,nickname,lower(nickname));return new;end $$;
revoke all on function public.handle_new_user()from public,anon,authenticated;
with candidates as(select id,lower(trim(display_name))nick,count(*)over(partition by lower(trim(display_name)))copies from public.profiles where trim(display_name)~'^[A-Za-z0-9_]{3,24}$')
update public.profiles p set username=c.nick from candidates c where p.id=c.id and p.username~'^orbiter_[a-f0-9]{12}$'and c.copies=1 and not exists(select 1 from public.profiles q where q.id<>p.id and lower(q.username)=c.nick);

create function orbita_private.can_call_conversation(target uuid)returns boolean language sql stable security definer set search_path=''as $$
 select exists(select 1 from public.conversations c join public.friendships f on least(f.requester_id,f.recipient_id)=c.user_a and greatest(f.requester_id,f.recipient_id)=c.user_b where c.id=target and auth.uid()in(c.user_a,c.user_b)and f.status='accepted'and orbita_private.can_send_dm(auth.uid(),case when c.user_a=auth.uid()then c.user_b else c.user_a end))$$;
create function public.can_call_conversation(target uuid)returns boolean language sql stable security invoker set search_path=''as $$select orbita_private.can_call_conversation(target)$$;
revoke all on function orbita_private.can_call_conversation(uuid),public.can_call_conversation(uuid)from public,anon;grant execute on function orbita_private.can_call_conversation(uuid),public.can_call_conversation(uuid)to authenticated;
drop policy call_event_insert on public.call_events;
create policy call_event_insert on public.call_events for insert to authenticated with check(caller_id=(select auth.uid())and orbita_private.can_call_conversation(conversation_id));

do $$begin if exists(select 1 from pg_publication where pubname='supabase_realtime')and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'and schemaname='public'and tablename='community_welcome')then alter publication supabase_realtime add table public.community_welcome;end if;end $$;

create or replace function public.export_my_data() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('exported_at',now(),'profile',(select to_jsonb(p)from public.profiles p where id=auth.uid()),
 'messages',coalesce((select jsonb_agg(to_jsonb(m))from public.messages m where author_id=auth.uid()),'[]'::jsonb),
 'direct_messages',coalesce((select jsonb_agg(to_jsonb(m))from public.direct_messages m where author_id=auth.uid()),'[]'::jsonb),
 'posts',coalesce((select jsonb_agg(to_jsonb(p))from public.social_posts p where author_id=auth.uid()),'[]'::jsonb),
 'stories',coalesce((select jsonb_agg(to_jsonb(s))from public.social_stories s where author_id=auth.uid()),'[]'::jsonb),
 'following',coalesce((select jsonb_agg(to_jsonb(f))from public.social_follows f where follower_id=auth.uid()),'[]'::jsonb),
 'lists',coalesce((select jsonb_agg(to_jsonb(l))from public.social_lists l where owner_id=auth.uid()),'[]'::jsonb),
 'list_members',coalesce((select jsonb_agg(to_jsonb(l))from public.social_list_members l),'[]'::jsonb),
 'privacy',(select to_jsonb(p)from public.social_privacy p where user_id=auth.uid()),
 'notifications',(select to_jsonb(p)from public.notification_preferences p where user_id=auth.uid()),
 'channel_notifications',coalesce((select jsonb_agg(to_jsonb(p))from public.channel_notification_preferences p where user_id=auth.uid()),'[]'::jsonb),
 'friendships',coalesce((select jsonb_agg(to_jsonb(f))from public.friendships f where auth.uid()in(requester_id,recipient_id)),'[]'::jsonb),
 'bookmarks',coalesce((select jsonb_agg(to_jsonb(b))from public.social_bookmarks b where user_id=auth.uid()),'[]'::jsonb),
 'social_reactions',coalesce((select jsonb_agg(to_jsonb(r))from public.social_reactions r where user_id=auth.uid()),'[]'::jsonb),
 'questions',coalesce((select jsonb_agg(to_jsonb(q))from public.social_questions q where auth.uid()in(author_id,recipient_id)),'[]'::jsonb),
 'memberships',coalesce((select jsonb_agg(to_jsonb(m))from public.community_members m where user_id=auth.uid()),'[]'::jsonb),
 'sessions',public.my_sessions())where auth.uid() is not null $$;

create function public.expired_my_stories()returns jsonb language sql stable security invoker set search_path=''as $$select coalesce(jsonb_agg(jsonb_build_object('id',id,'media_path',media_path)),'[]'::jsonb)from public.social_stories where author_id=auth.uid()and expires_at<=now()and not highlighted$$;
revoke all on function public.expired_my_stories()from public,anon;grant execute on function public.expired_my_stories()to authenticated;

drop policy social_follows_remove on public.social_follows;
create policy social_follows_remove on public.social_follows for delete to authenticated using((select auth.uid())in(follower_id,following_id));
create function orbita_private.limit_social_requests()returns trigger language plpgsql security invoker set search_path=''as $$begin
 perform pg_advisory_xact_lock(hashtext('social-requests:'||auth.uid()::text));
 if tg_table_name='social_questions'and(select count(*)from public.social_questions where author_id=auth.uid()and created_at>now()-interval'1 minute')>=10 then raise exception'Aguarde um minuto antes de enviar outra pergunta';end if;
 if tg_table_name='safety_reports'and(select count(*)from public.safety_reports where reporter_id=auth.uid()and created_at>now()-interval'1 minute')>=10 then raise exception'Aguarde um minuto antes de enviar outra denúncia';end if;return new;end $$;
revoke all on function orbita_private.limit_social_requests()from public,anon,authenticated;
create trigger social_question_limits before insert on public.social_questions for each row execute function orbita_private.limit_social_requests();
create trigger safety_report_limits before insert on public.safety_reports for each row execute function orbita_private.limit_social_requests();

create function orbita_private.revoke_my_session(target uuid)returns boolean language plpgsql security definer set search_path=''as $$declare changed integer;current_session text:=auth.jwt()->>'session_id';begin
 if auth.uid()is null or current_session is null then raise exception'Entre novamente para gerenciar os dispositivos';end if;
 if target::text=current_session then raise exception'Use Sair para encerrar este aparelho';end if;
 delete from auth.sessions where id=target and user_id=auth.uid();get diagnostics changed=row_count;return changed=1;end $$;
create function public.revoke_my_session(target uuid)returns boolean language sql security invoker set search_path=''as $$select orbita_private.revoke_my_session(target)$$;
revoke all on function orbita_private.revoke_my_session(uuid),public.revoke_my_session(uuid)from public,anon;grant execute on function orbita_private.revoke_my_session(uuid),public.revoke_my_session(uuid)to authenticated;

create function orbita_private.trending_communities()returns jsonb language sql stable security definer set search_path=''as $$select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb)from(
 select c.id,c.name,c.description,coalesce(w.category,'Geral')category,count(m.user_id)members,count(m.user_id)filter(where m.joined_at>now()-interval'1 day')new_members
 from public.communities c left join public.community_welcome w on w.community_id=c.id left join public.community_members m on m.community_id=c.id
 where auth.uid()is not null and not c.invite_only and not orbita_private.is_banned(c.id,auth.uid())
 group by c.id,c.name,c.description,w.category order by count(m.user_id)filter(where m.joined_at>now()-interval'1 day')desc,count(m.user_id)desc,c.name limit 30)t$$;
create function public.trending_communities()returns jsonb language sql stable security invoker set search_path=''as $$select orbita_private.trending_communities()$$;
revoke all on function orbita_private.trending_communities(),public.trending_communities()from public,anon;grant execute on function orbita_private.trending_communities(),public.trending_communities()to authenticated;

insert into public.channels(name,kind,community_id,created_by,position,description)
select 'sugestões','text',c.id,(select user_id from public.site_roles where role='creator'order by created_at limit 1),coalesce((select max(position)+1 from public.channels where community_id=c.id),0),'Ideias, sugestões e melhorias para a Órbita.'
from public.communities c where c.is_default and not exists(select 1 from public.channels ch where ch.community_id=c.id and lower(ch.name)in('sugestões','sugestoes'));

create index safety_reports_media on public.safety_reports using gin(media_paths);
create policy reported_media_review on storage.objects for select to authenticated using((select public.is_site_admin())and exists(select 1 from public.safety_reports r where r.media_paths@>array[name]and((bucket_id='orbita-feed'and r.target_kind='post')or(bucket_id='orbita-files'and r.target_kind in('message','dm','profile')))));
create function orbita_private.review_report(target uuid,note text,remove_content boolean)returns jsonb language plpgsql security definer set search_path=''as $$declare report public.safety_reports;removed integer:=0;begin
 if not public.is_site_admin()then raise exception'Acesso negado'using errcode='42501';end if;
 if char_length(btrim(note))not between 5 and 1000 then raise exception'Registre a justificativa da decisão';end if;
 select * into report from public.safety_reports where id=target for update;if not found then raise exception'Denúncia indisponível';end if;
 if remove_content then
  case report.target_kind when'post'then delete from public.social_posts where id=report.target_id;
  when'message'then delete from public.messages where id=report.target_id;
  when'dm'then delete from public.direct_messages where id=report.target_id;
  else raise exception'Use os controles de membros para moderar um perfil';end case;get diagnostics removed=row_count;
 end if;
 update public.safety_reports set resolution=btrim(note)where id=target;
 return jsonb_build_object('removed',removed>0);end $$;
create function public.review_report(target uuid,note text,remove_content boolean default false)returns jsonb language sql security invoker set search_path=''as $$select orbita_private.review_report(target,note,remove_content)$$;
revoke all on function orbita_private.review_report(uuid,text,boolean),public.review_report(uuid,text,boolean)from public,anon;grant execute on function orbita_private.review_report(uuid,text,boolean),public.review_report(uuid,text,boolean)to authenticated;
