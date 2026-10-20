-- Run as the database owner in a transaction; every fixture is rolled back.
begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('a1000000-0000-4000-8000-000000000001','qa-feed-a@example.invalid','{"display_name":"QA Feed A"}'),
 ('a1000000-0000-4000-8000-000000000002','qa-feed-b@example.invalid','{"display_name":"QA Feed B"}'),
 ('a1000000-0000-4000-8000-000000000003','qa-feed-c@example.invalid','{"display_name":"QA Feed C"}');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into public.social_posts(id,content) values ('b1000000-0000-4000-8000-000000000001','Publicação #orbita para buscar');
insert into storage.objects(bucket_id,name,owner_id,metadata) values ('orbita-feed','a1000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000004/c1000000-0000-4000-8000-000000000001.webp',auth.uid()::text,'{"mimetype":"image/webp","size":100}');
insert into public.social_posts(id,content,media) values ('b1000000-0000-4000-8000-000000000004','Anexo de teste',array['a1000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000004/c1000000-0000-4000-8000-000000000001.webp']);
insert into public.social_bookmarks(post_id) values ('b1000000-0000-4000-8000-000000000001');
insert into public.social_follows(following_id) values ('a1000000-0000-4000-8000-000000000002');
do $$begin
 if not exists(select 1 from public.social_posts where author_id=auth.uid()) then raise exception 'author cannot read own post';end if;
 if jsonb_array_length(public.social_timeline(search_text=>'#orbita'))<>1 then raise exception 'hashtag search failed';end if;
 begin
  insert into public.social_posts(author_id,content) values ('a1000000-0000-4000-8000-000000000002','Forged');
  raise exception 'forged author accepted';exception when insufficient_privilege then null;end;
 begin
  update public.social_posts set created_at=now() where author_id=auth.uid();raise exception 'date rewrite accepted';exception when insufficient_privilege then null;end;
 begin
  insert into public.social_posts(content,media) values ('Invalid media',array['someone-elses-file.jpg']);raise exception 'foreign media accepted';exception when raise_exception then if sqlerrm='foreign media accepted' then raise;end if;end;
 begin
  insert into public.social_posts(content) values (repeat('a',281));raise exception 'long post accepted';exception when check_violation then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$declare changed int;begin
 if not exists(select 1 from storage.objects where bucket_id='orbita-feed' and name like 'a1000000-0000-4000-8000-000000000001/%') then raise exception 'visible post media unreadable';end if;
 if (select count(*) from public.social_bookmarks)<>0 then raise exception 'bookmarks leaked';end if;
 update public.social_posts set content='Forged edit' where id='b1000000-0000-4000-8000-000000000001';get diagnostics changed=row_count;
 if changed<>0 then raise exception 'other author edited post';end if;
 delete from public.social_posts where id='b1000000-0000-4000-8000-000000000001';get diagnostics changed=row_count;
 if changed<>0 then raise exception 'other author deleted post';end if;
end $$;
insert into public.social_likes(post_id) values ('b1000000-0000-4000-8000-000000000001');
insert into public.social_reposts(post_id) values ('b1000000-0000-4000-8000-000000000001');
insert into public.social_reports(post_id,reason) values ('b1000000-0000-4000-8000-000000000001','Relatório de teste');
insert into public.social_posts(id,content,reply_to) values ('b1000000-0000-4000-8000-000000000002','Resposta','b1000000-0000-4000-8000-000000000001');
insert into public.social_posts(id,quote_id) values ('b1000000-0000-4000-8000-000000000003','b1000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$begin if jsonb_array_length(public.social_activity())<>4 then raise exception 'own notifications incorrect';end if;end $$;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$begin if jsonb_array_length(public.social_activity())<>0 then raise exception 'notifications leaked to third party';end if;end $$;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
insert into public.social_blocks(blocked_id) values ('a1000000-0000-4000-8000-000000000001');
do $$begin
 if exists(select 1 from storage.objects where bucket_id='orbita-feed' and name like 'a1000000-0000-4000-8000-000000000001/%') then raise exception 'blocked media visible';end if;
 if exists(select 1 from public.social_posts where id='b1000000-0000-4000-8000-000000000001') then raise exception 'block did not hide author';end if;
 if not orbita_private.social_visible(auth.uid()) then raise exception 'self hidden';end if;
end $$;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$begin
 if exists(select 1 from public.social_blocks) then raise exception 'reverse block rows leaked';end if;
 if exists(select 1 from public.social_posts where author_id='a1000000-0000-4000-8000-000000000002') then raise exception 'reverse block did not hide posts';end if;
 if exists(select 1 from public.social_reports) then raise exception 'reporter privacy violated';end if;
 if orbita_private.social_visible('a1000000-0000-4000-8000-000000000002') then raise exception 'reverse block check failed';end if;
end $$;
-- Parent deletion retains thread/quote semantics and cannot promote old replies into the root feed.
delete from public.social_posts where id='b1000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$begin
 if not exists(select 1 from public.social_posts where id='b1000000-0000-4000-8000-000000000002' and is_reply and reply_to is null) then raise exception 'deleted parent lost reply flag';end if;
 if not exists(select 1 from public.social_posts where id='b1000000-0000-4000-8000-000000000003' and is_quote and quote_id is null) then raise exception 'deleted quote lost flag';end if;
end $$;
reset role;
insert into public.site_roles(user_id,role) values ('a1000000-0000-4000-8000-000000000003','admin');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$declare changed int;begin
 if not orbita_private.social_moderator() then raise exception 'admin detection failed';end if;
 delete from public.social_posts where id='b1000000-0000-4000-8000-000000000002';get diagnostics changed=row_count;if changed<>1 then raise exception 'admin cannot delete';end if;
end $$;
reset role;
set local role anon;
do $$begin
 begin perform * from public.social_posts;raise exception 'anonymous access accepted';exception when insufficient_privilege then null;end;
 begin perform public.social_timeline();raise exception 'anonymous RPC accepted';exception when insufficient_privilege then null;end;
 begin perform public.social_activity();raise exception 'anonymous notifications accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'PASS: author ownership, authenticated access, private bookmarks, blocks in both directions, search, references, moderation and constraints' as social_feed_security;
rollback;
