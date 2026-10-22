-- Notifications are derived from existing rows; no public notification table or extra polling.
create function public.social_activity() returns jsonb language sql stable security invoker set search_path='' as $$
with events as (
 select l.user_id actor_id,l.post_id,l.created_at,'like'::text kind from public.social_likes l join public.social_posts p on p.id=l.post_id where p.author_id=auth.uid() and l.user_id<>auth.uid()
 union all select r.user_id,r.post_id,r.created_at,'repost' from public.social_reposts r join public.social_posts p on p.id=r.post_id where p.author_id=auth.uid() and r.user_id<>auth.uid()
 union all select r.author_id,r.id,r.created_at,'reply' from public.social_posts r join public.social_posts p on p.id=r.reply_to where p.author_id=auth.uid() and r.author_id<>auth.uid()
 union all select r.author_id,r.id,r.created_at,'quote' from public.social_posts r join public.social_posts p on p.id=r.quote_id where p.author_id=auth.uid() and r.author_id<>auth.uid()
 union all select f.follower_id,null::uuid,f.created_at,'follow' from public.social_follows f where f.following_id=auth.uid()
),page as (select * from events where orbita_private.social_visible(actor_id) order by created_at desc,actor_id limit 50)
select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('actor',(select jsonb_build_object('id',u.id,'display_name',u.display_name,'username',u.username,'avatar_url',u.avatar_url,'avatar_color',u.avatar_color) from public.profiles u where u.id=e.actor_id)) order by e.created_at desc),'[]'::jsonb) from page e $$;
revoke all on function public.social_activity() from public,anon;
grant execute on function public.social_activity() to authenticated;
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='social_posts') then
  alter publication supabase_realtime add table public.social_posts;
 end if;
end $$;
