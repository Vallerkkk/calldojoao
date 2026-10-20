grant insert(thread_root) on public.messages,public.direct_messages to authenticated;
grant insert(is_stage),update(is_stage) on public.channels to authenticated;
create policy push_config_deny_direct on orbita_private.push_config for all to authenticated using(false) with check(false);
create policy push_jobs_deny_direct on orbita_private.push_jobs for all to authenticated using(false) with check(false);
notify pgrst,'reload schema';
