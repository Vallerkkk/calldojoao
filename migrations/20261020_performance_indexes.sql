
-- Cover foreign keys used by joins and deletes without removing existing indexes.
create index if not exists creator_invites_claimed_by_idx on orbita_private.creator_invites(claimed_by);
create index if not exists attachments_owner_id_idx on public.attachments(owner_id);
create index if not exists call_events_caller_id_idx on public.call_events(caller_id);
create index if not exists channels_created_by_idx on public.channels(created_by);
create index if not exists communities_created_by_idx on public.communities(created_by);
create index if not exists direct_messages_attachment_id_idx on public.direct_messages(attachment_id);
create index if not exists direct_messages_author_id_idx on public.direct_messages(author_id);
create index if not exists direct_messages_reply_to_idx on public.direct_messages(reply_to);
create index if not exists messages_attachment_id_idx on public.messages(attachment_id);
create index if not exists messages_author_id_idx on public.messages(author_id);
create index if not exists messages_reply_to_idx on public.messages(reply_to);
create index if not exists music_state_attachment_id_idx on public.music_state(attachment_id);
create index if not exists music_state_updated_by_idx on public.music_state(updated_by);
create index if not exists poll_votes_user_id_idx on public.poll_votes(user_id);
create index if not exists reactions_user_id_idx on public.reactions(user_id);
