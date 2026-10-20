alter table public.channels add constraint channels_stage_voice check(not is_stage or kind='voice');
create or replace function orbita_private.guard_channel_write() returns trigger language plpgsql security definer set search_path='' as $$declare channel uuid; community uuid;begin
if tg_table_name='attachments' then channel:=new.channel_id;else select channel_id into channel from public.messages where id=new.message_id;end if;
if channel is null then return new;end if;select community_id into community from public.channels where id=channel;
if not orbita_private.can_read_channel(channel) or exists(select 1 from public.community_moderation where community_id=community and user_id=auth.uid() and (banned or timeout_until>now())) then raise exception 'Você está silenciado ou sem acesso ao servidor.';end if;return new;end$$;
revoke all on function orbita_private.guard_channel_write() from public,anon,authenticated;
create trigger collaboration_attachment_guard before insert on public.attachments for each row execute function orbita_private.guard_channel_write();
create trigger collaboration_reaction_guard before insert or update on public.reactions for each row execute function orbita_private.guard_channel_write();
alter publication supabase_realtime add table public.community_moderation;
notify pgrst,'reload schema';
