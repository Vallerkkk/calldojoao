-- Bound notification work on the free instance; leave room for provider retries.
create index if not exists push_jobs_created_idx on orbita_private.push_jobs(created_at);
create or replace function orbita_private.push_take(transport_key text)
returns jsonb language plpgsql security definer set search_path=''
as $$ declare result jsonb; begin
 if auth.uid() is null or not exists(select 1 from orbita_private.push_config where transport_hash=encode(sha256(convert_to(transport_key,'UTF8')),'hex')) then raise exception 'Transporte não autorizado.';end if;
 delete from orbita_private.push_jobs where created_at<now()-interval '2 days';
 with jobs as (select id from orbita_private.push_jobs where author_id=auth.uid() and not done and attempts<3 and created_at>now()-interval '10 minutes' and (lease_until is null or lease_until<now()) order by created_at for update skip locked limit 5), leased as (update orbita_private.push_jobs j set attempts=attempts+1,lease_until=now()+interval '90 seconds' from jobs where j.id=jobs.id returning j.*)
 select coalesce(jsonb_agg(jsonb_build_object('job_id',j.id,'payload',j.payload,'subscription_id',s.id,'endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth)),'[]'::jsonb) into result from leased j join public.push_subscriptions s on s.user_id=j.recipient_id;
 return result;
end $$;
revoke all on function orbita_private.push_take(text) from public,anon;
grant execute on function orbita_private.push_take(text) to authenticated;
notify pgrst,'reload schema';
