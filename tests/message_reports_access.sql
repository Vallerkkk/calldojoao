begin;
create temporary table report_fixture(owner_id uuid,member_id uuid,outsider_id uuid,community_id uuid,channel_id uuid,message_id uuid) on commit drop;
insert into report_fixture values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
grant select on report_fixture to authenticated;
insert into auth.users(id,aud,role,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
select uid,'authenticated','authenticated','qa-'||uid||'@example.invalid',jsonb_build_object('display_name','QA_'||substr(replace(uid::text,'-',''),1,16)),'{}'::jsonb,now(),now()
from report_fixture f cross join lateral unnest(array[f.owner_id,f.member_id,f.outsider_id])uid;
insert into public.communities(id,name,created_by,invite_only)select community_id,'QA reports',owner_id,true from report_fixture;
insert into public.community_members(community_id,user_id)select community_id,member_id from report_fixture;
insert into public.channels(id,name,kind,community_id,created_by)select channel_id,'qa','text',community_id,owner_id from report_fixture;
select set_config('request.jwt.claim.sub',owner_id::text,true) from report_fixture;
insert into public.messages(id,channel_id,author_id,content)select message_id,channel_id,owner_id,'QA report target' from report_fixture;
set local role authenticated;
do $$declare f record;blocked boolean;affected integer;begin
 select * into f from report_fixture;
 perform set_config('request.jwt.claim.sub',f.outsider_id::text,true);
 blocked:=false;begin insert into public.message_reports(reporter_id,message_id,reason)values(f.outsider_id,f.message_id,'Should not see this');exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Outsider reported inaccessible message';end if;
 perform set_config('request.jwt.claim.sub',f.member_id::text,true);
 insert into public.message_reports(reporter_id,message_id,reason)values(f.member_id,f.message_id,'QA member report');
 update public.message_reports set resolved=true where reporter_id=f.member_id;get diagnostics affected=row_count;
 if affected<>0 then raise exception 'Member resolved own report';end if;
 blocked:=false;begin insert into public.message_reports(reporter_id,message_id,reason)values(f.owner_id,f.message_id,'Spoofed reporter');exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Reporter spoofing allowed';end if;
 perform set_config('request.jwt.claim.sub',f.outsider_id::text,true);
 if exists(select 1 from public.message_reports where reporter_id=f.member_id)then raise exception 'Report leaked to unrelated user';end if;
end $$;
reset role;
rollback;
