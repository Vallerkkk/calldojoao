begin;
create temporary table identity_fixture(creator uuid,member uuid,outsider uuid) on commit drop;
insert into identity_fixture values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
grant select on identity_fixture to authenticated;
insert into auth.users(id,aud,role,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
 select uid,'authenticated','authenticated','qa-'||uid||'@example.invalid',jsonb_build_object('display_name','QA_'||substr(replace(uid::text,'-',''),1,16)),'{}'::jsonb,now(),now()
 from identity_fixture f cross join lateral unnest(array[f.creator,f.member,f.outsider])uid;
insert into public.site_roles(user_id,role) select creator,'creator' from identity_fixture;
set local role authenticated;
do $$declare f record;original_nick text;blocked boolean;result boolean;begin
 select * into f from identity_fixture;
 perform set_config('request.jwt.claim.sub',f.outsider::text,true);
 blocked:=false;begin perform public.set_site_admin(f.member,true);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Regular user promoted an admin';end if;
 perform set_config('request.jwt.claim.sub',f.creator::text,true);
 if not public.set_site_admin(f.member,true) then raise exception 'Creator could not promote';end if;
 if public.set_site_admin(f.member,true) then raise exception 'Repeated grant was not idempotent';end if;
 if not exists(select 1 from public.site_roles where user_id=f.member and role='admin') then raise exception 'Missing admin';end if;
 perform set_config('request.jwt.claim.sub',f.member::text,true);
 blocked:=false;begin perform public.set_site_admin(f.outsider,true);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Admin promoted another admin';end if;
 blocked:=false;begin delete from public.site_roles where user_id=f.creator;exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Direct role mutation allowed';end if;
 select username into original_nick from public.profiles where id=f.member;
 if not exists(select 1 from public.profiles where id=f.member and username=lower(display_name))then raise exception 'Signup nickname mismatch';end if;
 update public.profiles set display_name='QA_'||substr(replace(f.member::text,'-',''),1,12) where id=f.member;
 if not exists(select 1 from public.profiles where id=f.member and username=lower(display_name))then raise exception 'Edited nickname mismatch';end if;
 blocked:=false;begin update public.profiles set display_name=(select display_name from public.profiles where id=f.creator) where id=f.member;exception when unique_violation then blocked:=true;end;
 if not blocked then raise exception 'Duplicate nickname accepted';end if;
 perform set_config('request.jwt.claim.sub',f.creator::text,true);
 blocked:=false;begin perform public.set_site_admin(f.creator,false);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Creator demotion allowed';end if;
 if not public.set_site_admin(f.member,false) then raise exception 'Creator could not revoke';end if;
 if exists(select 1 from public.site_roles where user_id=f.member)then raise exception 'Admin not removed';end if;
 if (select count(*) from public.site_admin_audit where target_id=f.member)<>2 then raise exception 'Incorrect audit';end if;
 if has_function_privilege('anon','public.set_site_admin(uuid,boolean)','execute') then raise exception 'Anonymous execution allowed';end if;
end $$;
reset role;
rollback;
