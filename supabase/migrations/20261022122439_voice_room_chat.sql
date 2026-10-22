-- An independent text history for each voice room/private call.
-- Older clients/consents keep their previous admin-only transcript visibility.
alter table public.voice_consents add column share_to_chat boolean not null default false;
alter table public.call_transcripts add column share_to_chat boolean not null default false;
grant insert(share_to_chat),update(share_to_chat)on public.voice_consents to authenticated;
grant insert(share_to_chat)on public.call_transcripts to authenticated;

create table public.voice_chat_messages(
 id uuid primary key default gen_random_uuid(),
 channel_id uuid references public.channels(id)on delete cascade,
 conversation_id uuid references public.conversations(id)on delete cascade,
 author_id uuid not null default auth.uid() references public.profiles(id)on delete cascade,
 content text not null check(char_length(btrim(content))between 1 and 4000),
 kind text not null default 'message'check(kind in('message','transcript')),
 transcript_id uuid unique references public.call_transcripts(id)on delete cascade,
 created_at timestamptz not null default now(),expires_at timestamptz,
 check(num_nonnulls(channel_id,conversation_id)=1),
 check((kind='transcript')=(transcript_id is not null))
);
create index voice_chat_channel_history on public.voice_chat_messages(channel_id,created_at desc,id desc)where channel_id is not null;
create index voice_chat_dm_history on public.voice_chat_messages(conversation_id,created_at desc,id desc)where conversation_id is not null;
create index voice_chat_author on public.voice_chat_messages(author_id);
alter table public.voice_chat_messages enable row level security;
revoke all on public.voice_chat_messages from public,anon,authenticated;
grant select,delete on public.voice_chat_messages to authenticated;
grant insert(id,channel_id,conversation_id,author_id,content)on public.voice_chat_messages to authenticated;
create policy voice_chat_read on public.voice_chat_messages for select to authenticated using(
 (expires_at is null or expires_at>now())and(
 channel_id is not null and exists(select 1 from public.channels c where c.id=channel_id and c.kind='voice'and orbita_private.can_read_channel(c.id))
 or conversation_id is not null and exists(select 1 from public.conversations c where c.id=conversation_id and (select auth.uid())in(c.user_a,c.user_b))));
create policy voice_chat_write on public.voice_chat_messages for insert to authenticated with check(
 author_id=(select auth.uid())and kind='message'and transcript_id is null and(
 channel_id is not null and exists(select 1 from public.channels c where c.id=channel_id and c.kind='voice'and orbita_private.can_read_channel(c.id)and not exists(select 1 from public.community_moderation m where m.community_id=c.community_id and m.user_id=(select auth.uid())and m.timeout_until>now()))
 or conversation_id is not null and exists(select 1 from public.conversations c where c.id=conversation_id and (select auth.uid())in(c.user_a,c.user_b)and orbita_private.can_send_dm((select auth.uid()),case when c.user_a=(select auth.uid())then c.user_b else c.user_a end))));
create policy voice_chat_delete on public.voice_chat_messages for delete to authenticated using(
 author_id=(select auth.uid())or channel_id is not null and exists(select 1 from public.channels c where c.id=channel_id and orbita_private.can_community(c.community_id,'manage_messages')));

create function orbita_private.voice_chat_guard()returns trigger language plpgsql security definer set search_path=''as $$begin
 if new.kind='message'then
  if auth.uid()is null or new.author_id<>auth.uid()then raise exception'Autor inválido'using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended('voice-chat:'||new.author_id::text,0));
  if(select count(*)from public.voice_chat_messages where author_id=new.author_id and kind='message'and created_at>now()-interval'1 minute')>=30 then raise exception'Aguarde antes de enviar mais mensagens';end if;
  new.created_at:=now();new.expires_at:=null;
 end if;return new;
end $$;
revoke all on function orbita_private.voice_chat_guard()from public,anon,authenticated;
create trigger voice_chat_guard before insert on public.voice_chat_messages for each row execute function orbita_private.voice_chat_guard();

create function orbita_private.publish_voice_transcript()returns trigger language plpgsql security definer set search_path=''as $$begin
 if not new.share_to_chat then return new;end if;
 if not exists(select 1 from public.voice_consents c where c.user_id=new.speaker_id and c.room_sid=new.room_sid and c.room_name=new.room_name and c.accepted and c.share_to_chat)then raise exception'Autorize o compartilhamento no chat desta chamada'using errcode='42501';end if;
 if new.room_name~'^channel-[0-9a-f-]{36}$'then
  insert into public.voice_chat_messages(id,channel_id,author_id,content,kind,transcript_id,expires_at)
  values(new.id,substring(new.room_name from 9)::uuid,new.speaker_id,new.content,'transcript',new.id,new.expires_at);
 elsif new.room_name~'^direct-[0-9a-f-]{36}$'then
  insert into public.voice_chat_messages(id,conversation_id,author_id,content,kind,transcript_id,expires_at)
  values(new.id,substring(new.room_name from 8)::uuid,new.speaker_id,new.content,'transcript',new.id,new.expires_at);
 end if;return new;
end $$;
revoke all on function orbita_private.publish_voice_transcript()from public,anon,authenticated;
create trigger publish_voice_transcript after insert on public.call_transcripts for each row execute function orbita_private.publish_voice_transcript();
alter publication supabase_realtime add table public.voice_chat_messages;
