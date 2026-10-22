-- Global, authenticated social feed. Existing chats and their policies are untouched.
create table public.social_blocks (
 blocker_id uuid references public.profiles(id) on delete cascade default auth.uid(),
 blocked_id uuid references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(), primary key(blocker_id,blocked_id), check(blocker_id<>blocked_id)
);
alter table public.social_blocks enable row level security;
create index social_blocks_reverse on public.social_blocks(blocked_id,blocker_id);
create or replace function orbita_private.social_visible(author uuid) returns boolean
 language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and not exists(select 1 from public.social_blocks b
 where (b.blocker_id=auth.uid() and b.blocked_id=author) or (b.blocker_id=author and b.blocked_id=auth.uid())) $$;
create or replace function orbita_private.social_moderator() returns boolean
 language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.site_roles where user_id=auth.uid() and role in ('admin','creator')) $$;
revoke all on function orbita_private.social_visible(uuid),orbita_private.social_moderator() from public,anon;
grant usage on schema orbita_private to authenticated;
grant execute on function orbita_private.social_visible(uuid),orbita_private.social_moderator() to authenticated;
create policy social_blocks_own on public.social_blocks for all to authenticated using(blocker_id=(select auth.uid())) with check(blocker_id=(select auth.uid()));

create table public.social_posts (
 id uuid primary key default gen_random_uuid(), author_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
 content text not null default '' check(char_length(content)<=280), media text[] not null default '{}' check(cardinality(media)<=4),
 reply_to uuid references public.social_posts(id) on delete set null,
 quote_id uuid references public.social_posts(id) on delete set null,
 is_reply boolean not null default false, is_quote boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz,
 check(length(btrim(content))>0 or cardinality(media)>0 or is_quote), check(reply_to is null or reply_to<>id),check(quote_id is null or quote_id<>id)
);
alter table public.social_posts enable row level security;
create index social_posts_timeline on public.social_posts(created_at desc,id desc) where not is_reply;
create index social_posts_author on public.social_posts(author_id,created_at desc,id desc);
create index social_posts_replies on public.social_posts(reply_to,created_at desc,id desc);
create index social_posts_quotes on public.social_posts(quote_id);
create index social_posts_search on public.social_posts using gin(to_tsvector('simple',content));
create policy social_posts_read on public.social_posts for select to authenticated using(orbita_private.social_visible(author_id));
create policy social_posts_insert on public.social_posts for insert to authenticated with check(author_id=(select auth.uid()));
create policy social_posts_edit on public.social_posts for update to authenticated using(author_id=(select auth.uid())) with check(author_id=(select auth.uid()));
create policy social_posts_delete on public.social_posts for delete to authenticated using(author_id=(select auth.uid()) or orbita_private.social_moderator());

create table public.social_follows (
 follower_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
 following_id uuid not null references public.profiles(id) on delete cascade, created_at timestamptz not null default now(),
 primary key(follower_id,following_id),check(follower_id<>following_id)
);
alter table public.social_follows enable row level security;
create index social_follows_reverse on public.social_follows(following_id,follower_id);
create policy social_follows_read on public.social_follows for select to authenticated using(orbita_private.social_visible(follower_id) and orbita_private.social_visible(following_id));
create policy social_follows_add on public.social_follows for insert to authenticated with check(follower_id=(select auth.uid()) and orbita_private.social_visible(following_id));
create policy social_follows_remove on public.social_follows for delete to authenticated using(follower_id=(select auth.uid()));

create table public.social_likes (post_id uuid references public.social_posts(id) on delete cascade,user_id uuid default auth.uid() references public.profiles(id) on delete cascade,created_at timestamptz not null default now(),primary key(post_id,user_id));
create table public.social_reposts (like public.social_likes including defaults including constraints including indexes);
alter table public.social_reposts add foreign key(post_id) references public.social_posts(id) on delete cascade, add foreign key(user_id) references public.profiles(id) on delete cascade;
create table public.social_bookmarks (like public.social_likes including defaults including constraints including indexes);
alter table public.social_bookmarks add foreign key(post_id) references public.social_posts(id) on delete cascade, add foreign key(user_id) references public.profiles(id) on delete cascade;
do $$declare t text;begin foreach t in array array['social_likes','social_reposts','social_bookmarks'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create index %I on public.%I(user_id,post_id)',t||'_user',t);
 execute format('create policy %I on public.%I for select to authenticated using (%s exists(select 1 from public.social_posts p where p.id=post_id))',t||'_read',t,case when t='social_bookmarks' then 'user_id=(select auth.uid()) and' else 'orbita_private.social_visible(user_id) and' end);
 execute format('create policy %I on public.%I for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.social_posts p where p.id=post_id))',t||'_add',t);
 execute format('create policy %I on public.%I for delete to authenticated using(user_id=(select auth.uid()))',t||'_remove',t);
end loop;end $$;

create table public.social_reports (
 id uuid primary key default gen_random_uuid(),post_id uuid not null references public.social_posts(id) on delete cascade,
 reporter_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
 reason text not null check(char_length(btrim(reason)) between 5 and 500),created_at timestamptz not null default now(),unique(post_id,reporter_id)
);
alter table public.social_reports enable row level security;
create index social_reports_reporter on public.social_reports(reporter_id);
create policy social_reports_read on public.social_reports for select to authenticated using(reporter_id=(select auth.uid()) or orbita_private.social_moderator());
create policy social_reports_add on public.social_reports for insert to authenticated with check(reporter_id=(select auth.uid()) and exists(select 1 from public.social_posts p where p.id=post_id));
create policy social_reports_remove on public.social_reports for delete to authenticated using(orbita_private.social_moderator());

-- Explicit column grants prevent changing authors, dates and media after publication.
revoke all on public.social_posts,public.social_likes,public.social_reposts,public.social_bookmarks,public.social_follows,public.social_blocks,public.social_reports from anon,authenticated;
grant select,delete on public.social_posts to authenticated;
grant insert(id,author_id,content,media,reply_to,quote_id),update(content) on public.social_posts to authenticated;
grant select,delete on public.social_likes,public.social_reposts,public.social_bookmarks,public.social_follows,public.social_blocks,public.social_reports to authenticated;
grant insert(post_id,user_id) on public.social_likes,public.social_reposts,public.social_bookmarks to authenticated;
grant insert(follower_id,following_id) on public.social_follows to authenticated;
grant insert(blocker_id,blocked_id) on public.social_blocks to authenticated;
grant insert(post_id,reporter_id,reason) on public.social_reports to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('orbita-feed','orbita-feed',false,26214400,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm']) on conflict(id) do nothing;
create policy social_media_upload on storage.objects for insert to authenticated with check(bucket_id='orbita-feed' and (storage.foldername(name))[1]=(select auth.uid())::text and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|gif|mp4|webm)$');
create policy social_media_read on storage.objects for select to authenticated using(bucket_id='orbita-feed' and ((storage.foldername(name))[1]=(select auth.uid())::text or exists(select 1 from public.social_posts p where name=any(p.media))));
create policy social_media_delete on storage.objects for delete to authenticated using(bucket_id='orbita-feed' and ((storage.foldername(name))[1]=(select auth.uid())::text or orbita_private.social_moderator()));

create function orbita_private.social_guard_post() returns trigger language plpgsql security invoker set search_path='' as $$
declare path text;begin
 if tg_op='INSERT' then
  if new.author_id<>auth.uid() then raise exception 'Autor inválido' using errcode='42501';end if;
  new.is_reply:=new.reply_to is not null;new.is_quote:=new.quote_id is not null;new.created_at:=clock_timestamp();new.updated_at:=null;
  if new.reply_to is not null and not exists(select 1 from public.social_posts where id=new.reply_to) then raise exception 'Publicação indisponível';end if;
  if new.quote_id is not null and not exists(select 1 from public.social_posts where id=new.quote_id) then raise exception 'Citação indisponível';end if;
  if (select count(*) from public.social_posts where author_id=auth.uid() and created_at>now()-interval '1 minute')>=10 then raise exception 'Aguarde um minuto antes de publicar novamente';end if;
  foreach path in array new.media loop
   if path !~ ('^'||new.author_id::text||'/'||new.id::text||'/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|gif|mp4|webm)$') or not exists(select 1 from storage.objects where bucket_id='orbita-feed' and name=path) then raise exception 'Anexo inválido';end if;
  end loop;
 else new.updated_at:=clock_timestamp();end if;
 return new;
end $$;
revoke all on function orbita_private.social_guard_post() from public,anon,authenticated;
create trigger social_guard_post before insert or update of content on public.social_posts for each row execute function orbita_private.social_guard_post();

-- A small, bounded page; all subqueries inherit the caller's RLS policies.
create function public.social_timeline(scope text default 'explore',before_at timestamptz default null,before_id uuid default null,search_text text default '',author_filter uuid default null,parent_filter uuid default null)
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
 and (before_at is null or (p.created_at,p.id)<(before_at,before_id))
 and (btrim(search_text)='' or to_tsvector('simple',p.content) @@ websearch_to_tsquery('simple',left(search_text,100)) or p.content ilike '%'||replace(replace(left(search_text,100),'%','\%'),'_','\_')||'%')
 order by p.created_at desc,p.id desc limit 25
 ) select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object(
 'author',(select jsonb_build_object('id',u.id,'display_name',u.display_name,'username',u.username,'avatar_url',u.avatar_url,'avatar_color',u.avatar_color) from public.profiles u where u.id=p.author_id),
 'likes',(select count(*) from public.social_likes l where l.post_id=p.id),
 'reposts',(select count(*) from public.social_reposts r where r.post_id=p.id),
 'replies',(select count(*) from public.social_posts r where r.reply_to=p.id),
 'liked',exists(select 1 from public.social_likes l where l.post_id=p.id and l.user_id=auth.uid()),
 'reposted',exists(select 1 from public.social_reposts r where r.post_id=p.id and r.user_id=auth.uid()),
 'saved',exists(select 1 from public.social_bookmarks b where b.post_id=p.id and b.user_id=auth.uid()),
 'quote',(select jsonb_build_object('id',q.id,'content',q.content,'author',u.display_name) from public.social_posts q join public.profiles u on u.id=q.author_id where q.id=p.quote_id)
 ) order by p.created_at desc,p.id desc),'[]'::jsonb) from page p $$;

create function public.social_people(search_text text default '',profile_id uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(u)||jsonb_build_object(
 'followers',(select count(*) from public.social_follows where following_id=u.id),
 'following_count',(select count(*) from public.social_follows where follower_id=u.id),
 'following',exists(select 1 from public.social_follows where follower_id=auth.uid() and following_id=u.id))), '[]'::jsonb)
 from (select id,username,display_name,bio,avatar_color,avatar_url,banner_url,pronouns,custom_status from public.profiles where orbita_private.social_visible(id)
 and (profile_id is null or id=profile_id) and (search_text='' or strpos(lower(coalesce(username,'')||' '||display_name),lower(left(search_text,60)))>0)
 order by (id=auth.uid()),display_name,id limit 12) u $$;
revoke all on function public.social_timeline(text,timestamptz,uuid,text,uuid,uuid),public.social_people(text,uuid) from public,anon;
grant execute on function public.social_timeline(text,timestamptz,uuid,text,uuid,uuid),public.social_people(text,uuid) to authenticated;
