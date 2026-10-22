create function orbita_private.voice_room_access(room_name text)returns boolean language sql stable security invoker set search_path=''as $$
 select case when room_name~'^channel-[0-9a-f-]{36}$'then exists(select 1 from public.channels c where c.id=substring(room_name from 9)::uuid and c.kind='voice')
 when room_name~'^direct-[0-9a-f-]{36}$'then public.can_call_conversation(substring(room_name from 8)::uuid)else false end $$;
revoke all on function orbita_private.voice_room_access(text)from public,anon;grant execute on function orbita_private.voice_room_access(text)to authenticated;
create table public.voice_consents(user_id uuid references public.profiles(id)on delete cascade,room_sid text check(room_sid~'^RM_[A-Za-z0-9]{1,64}$'),room_name text not null,accepted boolean not null default false,updated_at timestamptz not null default now(),primary key(user_id,room_sid));
alter table public.voice_consents enable row level security;
create policy voice_consent_own on public.voice_consents for all to authenticated using(user_id=(select auth.uid()))with check(user_id=(select auth.uid())and orbita_private.voice_room_access(room_name));
revoke all on public.voice_consents from public,anon,authenticated;grant select,delete on public.voice_consents to authenticated;grant insert(user_id,room_sid,room_name,accepted),update(user_id,room_sid,room_name,accepted)on public.voice_consents to authenticated;
create function orbita_private.voice_consent_time()returns trigger language plpgsql set search_path=''as $$begin new.updated_at:=now();return new;end $$;
revoke all on function orbita_private.voice_consent_time()from public,anon,authenticated;
create trigger voice_consent_time before insert or update on public.voice_consents for each row execute function orbita_private.voice_consent_time();
create table public.call_transcripts(id uuid primary key default gen_random_uuid(),room_sid text not null,room_name text not null,speaker_id uuid not null references public.profiles(id)on delete cascade,content text not null check(length(content)between 1 and 2000),created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval'7 days');
create index call_transcripts_time on public.call_transcripts(created_at desc);
create index call_transcripts_room_time on public.call_transcripts(room_sid,created_at desc);create index call_transcripts_speaker_time on public.call_transcripts(speaker_id,created_at desc);create index call_transcripts_expiry on public.call_transcripts(expires_at);
alter table public.call_transcripts enable row level security;
create policy call_transcripts_admin_read on public.call_transcripts for select to authenticated using((select public.is_site_admin())and expires_at>now());
create policy call_transcripts_admin_delete on public.call_transcripts for delete to authenticated using((select public.is_site_admin()));
create policy call_transcripts_self_insert on public.call_transcripts for insert to authenticated with check(speaker_id=(select auth.uid())and orbita_private.voice_room_access(room_name)and exists(select 1 from public.voice_consents c where c.user_id=(select auth.uid())and c.room_sid=call_transcripts.room_sid and c.room_name=call_transcripts.room_name and c.accepted));
revoke all on public.call_transcripts from public,anon,authenticated;grant select,delete on public.call_transcripts to authenticated;grant insert(id,room_sid,room_name,speaker_id,content)on public.call_transcripts to authenticated;
create function orbita_private.voice_transcript_limit()returns trigger language plpgsql security definer set search_path=''as $$begin
 perform pg_advisory_xact_lock(hashtextextended('voice-text-budget',0));
 if(select count(*)from public.call_transcripts where created_at>=date_trunc('day',now()))>=5000 then raise exception'Limite diário de transcrições atingido';end if;
 perform pg_advisory_xact_lock(hashtextextended('voice-text:'||new.speaker_id::text,0));
 if(select count(*)from public.call_transcripts where speaker_id=new.speaker_id and created_at>now()-interval'1 minute')>=20 then raise exception'Limite de transcrição atingido'using errcode='P0001';end if;
 delete from public.call_transcripts where expires_at<=now();new.created_at:=now();new.expires_at:=now()+interval'7 days';return new;end $$;
revoke all on function orbita_private.voice_transcript_limit()from public,anon,authenticated;
create trigger voice_transcript_limit before insert on public.call_transcripts for each row execute function orbita_private.voice_transcript_limit();
create table public.luladroid_requests(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id)on delete cascade,room_sid text not null,created_at timestamptz not null default now());
create index luladroid_requests_user_time on public.luladroid_requests(user_id,created_at desc);create index luladroid_requests_time on public.luladroid_requests(created_at desc);
alter table public.luladroid_requests enable row level security;revoke all on public.luladroid_requests from public,anon,authenticated;
create function orbita_private.reserve_luladroid(room_key text,room_name text)returns uuid language plpgsql security definer set search_path=''as $$declare result uuid;begin
 if auth.uid()is null or not exists(select 1 from public.voice_consents c where c.user_id=auth.uid()and c.room_sid=room_key and c.room_name=reserve_luladroid.room_name and c.accepted)then raise exception'Consentimento necessário'using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('luladroid-budget',0));
 if(select count(*)from public.luladroid_requests where created_at>=date_trunc('day',now()))>=50 or(select count(*)from public.luladroid_requests where created_at>now()-interval'1 minute')>=3 or exists(select 1 from public.luladroid_requests where user_id=auth.uid()and created_at>now()-interval'20 seconds')then raise exception'Limite gratuito do assistente atingido';end if;
 delete from public.luladroid_requests where created_at<now()-interval'8 days';delete from public.voice_consents where updated_at<now()-interval'1 day';
 insert into public.luladroid_requests(user_id,room_sid)values(auth.uid(),room_key)returning id into result;return result;end $$;
create function public.reserve_luladroid(room_key text,room_name text)returns uuid language sql security invoker set search_path=''as $$select orbita_private.reserve_luladroid(room_key,room_name)$$;
revoke all on function public.reserve_luladroid(text,text),orbita_private.reserve_luladroid(text,text)from public,anon;grant execute on function public.reserve_luladroid(text,text),orbita_private.reserve_luladroid(text,text)to authenticated;
