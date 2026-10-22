begin;
create temporary table diagnostic_fixture(user_id uuid,admin_id uuid)on commit drop;
insert into diagnostic_fixture values(gen_random_uuid(),gen_random_uuid());grant select on diagnostic_fixture to authenticated;
insert into auth.users(id,aud,role,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
select u,'authenticated','authenticated','qa-'||u||'@example.invalid',jsonb_build_object('display_name','QA_'||substr(replace(u::text,'-',''),1,16)),'{}'::jsonb,now(),now()from diagnostic_fixture cross join lateral unnest(array[user_id,admin_id])u;
insert into public.site_roles(user_id,role)select admin_id,'admin'from diagnostic_fixture;
set local role authenticated;
do $$declare f record;denied boolean;begin
 select * into f from diagnostic_fixture;perform set_config('request.jwt.claim.sub',f.user_id::text,true);
 if not public.record_app_diagnostics('[{"screen":"voice","signal":"api_error","count":3}]')then raise exception'First batch rejected';end if;
 if public.record_app_diagnostics('[{"screen":"voice","signal":"view","count":1}]')then raise exception'Rate limit bypassed';end if;
 if exists(select 1 from public.app_diagnostic_counts)then raise exception'Ordinary user read global report';end if;
 denied:=false;begin perform public.record_app_diagnostics('[{"screen":"voice","signal":"api_error","count":1,"message":"sensitive text"}]');exception when invalid_parameter_value then denied:=true;end;if not denied then raise exception'Free-text field accepted';end if;
 denied:=false;begin insert into public.app_diagnostic_findings values('voice','api_error','alta','Forged report','gemini-2.5-flash-lite',now());exception when insufficient_privilege then denied:=true;end;if not denied then raise exception'Ordinary user forged AI suggestion';end if;
 denied:=false;begin insert into public.call_transcripts(room_sid,room_name,speaker_id,content)values('RM_QA','channel-00000000-0000-4000-8000-000000000000',f.user_id,'Forbidden capture');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception'Retired capture accepted';end if;
 denied:=false;begin insert into public.voice_consents(user_id,room_sid,room_name,accepted)values(f.user_id,'RM_QA','channel-00000000-0000-4000-8000-000000000000',true);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception'Retired consent accepted';end if;
 perform set_config('request.jwt.claim.sub',f.admin_id::text,true);
 if not exists(select 1 from public.app_diagnostic_counts where screen='voice'and signal='api_error')then raise exception'Administrator cannot read counters';end if;
 insert into public.app_diagnostic_findings values('voice','api_error','média','Revisar a conexão como hipótese técnica.','gemini-2.5-flash-lite',now())on conflict(screen,signal)do update set suggestion=excluded.suggestion;
 if not exists(select 1 from public.app_diagnostic_findings where screen='voice'and signal='api_error')then raise exception'Administrator cannot read report';end if;
end $$;
reset role;
-- Budget shared by all users, including concurrent requests, survives process restarts.
delete from orbita_private.diagnostic_analysis_limits;
set local role authenticated;
do $$begin
 perform set_config('request.jwt.claim.sub',(select user_id::text from diagnostic_fixture),true);
 if not public.reserve_diagnostic_analysis()then raise exception'First budget reservation failed';end if;
 if public.reserve_diagnostic_analysis()then raise exception'Hourly budget bypass';end if;
end $$;
reset role;
update orbita_private.diagnostic_analysis_limits set attempts=4,last_attempt=now()-interval'2 hours';
set local role authenticated;
do $$begin if public.reserve_diagnostic_analysis()then raise exception'Daily budget bypass';end if;end $$;
reset role;
select 'diagnostics access, capture removal, privacy and budgets passed' as result;
rollback;
