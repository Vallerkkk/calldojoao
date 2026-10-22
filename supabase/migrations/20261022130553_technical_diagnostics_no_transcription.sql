-- Stop old clients as well as the new UI. Preserve existing room text/history.
drop policy if exists call_transcripts_self_insert on public.call_transcripts;
drop policy if exists voice_consents_self_write on public.voice_consents;
revoke insert on public.call_transcripts,public.voice_consents from authenticated,anon;
-- Column grants are independent of table grants.
revoke insert(id,room_sid,room_name,speaker_id,content,share_to_chat)on public.call_transcripts from authenticated;
revoke insert(user_id,room_sid,room_name,accepted,share_to_chat)on public.voice_consents from authenticated;
create or replace function orbita_private.reject_retired_transcription()returns trigger language plpgsql set search_path=''as $$begin
 raise exception'Transcrição de chamadas desativada'using errcode='42501';end $$;
revoke all on function orbita_private.reject_retired_transcription()from public,anon,authenticated;
create trigger retired_transcription before insert on public.call_transcripts for each row execute function orbita_private.reject_retired_transcription();
create function orbita_private.disable_voice_consent()returns trigger language plpgsql set search_path=''as $$begin
 if new.accepted or new.share_to_chat then raise exception'Transcrição de chamadas desativada'using errcode='42501';end if;return new;end $$;
revoke all on function orbita_private.disable_voice_consent()from public,anon,authenticated;
create trigger retired_voice_consent before insert or update on public.voice_consents for each row execute function orbita_private.disable_voice_consent();
update public.voice_consents set accepted=false,share_to_chat=false where accepted or share_to_chat;
revoke execute on function public.reserve_luladroid(text,text),orbita_private.reserve_luladroid(text,text)from authenticated;

create table public.app_diagnostic_counts(
 day date not null,screen text not null check(screen in('messages','voice','feed','friends','settings','other')),
 signal text not null check(signal in('view','javascript_error','promise_error','resource_error','navigation_slow','long_task','api_error')),
 count bigint not null check(count between 1 and 1000000000),primary key(day,screen,signal));
alter table public.app_diagnostic_counts enable row level security;
revoke all on public.app_diagnostic_counts from public,anon,authenticated;
grant select on public.app_diagnostic_counts to authenticated;
create policy diagnostics_admin_read on public.app_diagnostic_counts for select to authenticated using((select public.is_site_admin()));

create table public.app_diagnostic_findings(
 screen text not null check(screen in('messages','voice','feed','friends','settings','other')),
 signal text not null check(signal in('javascript_error','promise_error','resource_error','navigation_slow','long_task','api_error')),
 priority text not null check(priority in('baixa','média','alta')),
 suggestion text not null check(char_length(suggestion)between 5 and 600),
 model text not null check(model='gemini-2.5-flash-lite'),updated_at timestamptz not null default now(),primary key(screen,signal));
alter table public.app_diagnostic_findings enable row level security;
revoke all on public.app_diagnostic_findings from public,anon,authenticated;
grant select,insert,update on public.app_diagnostic_findings to authenticated;
create policy findings_admin_read on public.app_diagnostic_findings for select to authenticated using((select public.is_site_admin()));
create policy findings_admin_insert on public.app_diagnostic_findings for insert to authenticated with check((select public.is_site_admin()));
create policy findings_admin_update on public.app_diagnostic_findings for update to authenticated using((select public.is_site_admin()))with check((select public.is_site_admin()));

create table orbita_private.diagnostic_collection_limits(user_id uuid primary key references auth.users(id)on delete cascade,last_seen timestamptz not null);
create table orbita_private.diagnostic_analysis_limits(day date primary key,attempts int not null check(attempts between 1 and 4),last_attempt timestamptz not null);
alter table orbita_private.diagnostic_collection_limits enable row level security;
alter table orbita_private.diagnostic_analysis_limits enable row level security;
revoke all on orbita_private.diagnostic_collection_limits,orbita_private.diagnostic_analysis_limits from public,anon,authenticated;

create function orbita_private.record_app_diagnostics(events jsonb)returns boolean language plpgsql security definer set search_path=''as $$
declare event jsonb;n int;screen_name text;signal_name text;begin
 if auth.uid()is null then raise exception'Entre na sua conta'using errcode='42501';end if;
 if jsonb_typeof(events)<>'array'or jsonb_array_length(events)not between 1 and 12 then raise exception'Contadores inválidos'using errcode='22023';end if;
 -- Validate the entire batch before writing any row. No arbitrary payload text accepted.
 for event in select value from jsonb_array_elements(events)loop
  if jsonb_typeof(event)<>'object'or jsonb_typeof(event->'count')<>'number'or not(event ?& array['screen','signal','count'])or(event-array['screen','signal','count'])<>'{}'::jsonb then raise exception'Contador inválido'using errcode='22023';end if;
  if(event->>'screen')not in('messages','voice','feed','friends','settings','other')or(event->>'signal')not in('view','javascript_error','promise_error','resource_error','navigation_slow','long_task','api_error')or(event->>'count')!~'^[0-9]{1,2}$'then raise exception'Categoria inválida'using errcode='22023';end if;
  n:=(event->>'count')::int;if n not between 1 and 20 then raise exception'Contagem inválida'using errcode='22023';end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('diagnostic-user:'||auth.uid()::text,0));
 if exists(select 1 from orbita_private.diagnostic_collection_limits where user_id=auth.uid()and last_seen>now()-interval'1 minute')then return false;end if;
 insert into orbita_private.diagnostic_collection_limits values(auth.uid(),now())on conflict(user_id)do update set last_seen=excluded.last_seen;
 for event in select value from jsonb_array_elements(events)loop
  insert into public.app_diagnostic_counts(day,screen,signal,count)values((now()at time zone'UTC')::date,event->>'screen',event->>'signal',(event->>'count')::int)
  on conflict(day,screen,signal)do update set count=least(1000000000,app_diagnostic_counts.count+excluded.count);
 end loop;
 delete from public.app_diagnostic_counts where day<(now()at time zone'UTC')::date-29;
 delete from public.app_diagnostic_findings where updated_at<now()-interval'30 days';
 delete from orbita_private.diagnostic_collection_limits where last_seen<now()-interval'2 days';
 return true;end $$;
create function public.record_app_diagnostics(events jsonb)returns boolean language sql security invoker set search_path=''as $$select orbita_private.record_app_diagnostics(events)$$;
revoke all on function public.record_app_diagnostics(jsonb),orbita_private.record_app_diagnostics(jsonb)from public,anon;
grant execute on function public.record_app_diagnostics(jsonb),orbita_private.record_app_diagnostics(jsonb)to authenticated;

create function orbita_private.reserve_diagnostic_analysis()returns boolean language plpgsql security definer set search_path=''as $$begin
 if auth.uid()is null then raise exception'Entre na sua conta'using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('diagnostic-analysis-budget',0));
 if exists(select 1 from orbita_private.diagnostic_analysis_limits where last_attempt>now()-interval'1 hour')or exists(select 1 from orbita_private.diagnostic_analysis_limits where day=(now()at time zone'UTC')::date and attempts>=4)then return false;end if;
 insert into orbita_private.diagnostic_analysis_limits values((now()at time zone'UTC')::date,1,now())on conflict(day)do update set attempts=diagnostic_analysis_limits.attempts+1,last_attempt=excluded.last_attempt;
 delete from orbita_private.diagnostic_analysis_limits where day<(now()at time zone'UTC')::date-2;
 return true;end $$;
create function public.reserve_diagnostic_analysis()returns boolean language sql security invoker set search_path=''as $$select orbita_private.reserve_diagnostic_analysis()$$;
revoke all on function public.reserve_diagnostic_analysis(),orbita_private.reserve_diagnostic_analysis()from public,anon;
grant execute on function public.reserve_diagnostic_analysis(),orbita_private.reserve_diagnostic_analysis()to authenticated;
