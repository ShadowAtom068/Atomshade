# Atomshade admin guide (Supabase dashboard)

You do not need a separate admin website. Everything below is done in Supabase -> SQL Editor (only you can open it).

## Reports waiting for you
```sql
select r.created_at, r.kind, r.reason, r.evidence, r.evidence_verified,
       rep.name as reporter, tgt.name as reported, r.id
from public.reports r
left join public.profiles rep on rep.id = r.reporter_id
left join public.profiles tgt on tgt.id = r.reported_id
where r.status = 'open'
order by r.created_at desc;
```
`evidence_verified = true` means the text was copied from the database. For secret chats it is `false`: the server cannot read them, so the text is what the reporter's phone sent.

Mark one as handled:
```sql
update public.reports set status = 'actioned' where id = '<report id>';   -- or 'reviewed' / 'dismissed'
```

## Remove a bad user
Supabase -> Authentication -> Users -> find them -> Delete user. Their profile and messages are removed.

## How many people use the app
```sql
select count(*) as users from public.profiles;
select count(*) as messages_today from public.messages where created_at > now() - interval '1 day';
```

## Storage used (free plan allows 1 GB files, 500 MB database)
```sql
select pg_size_pretty(pg_database_size(current_database())) as database_size;
select bucket_id, count(*) files, pg_size_pretty(sum((metadata->>'size')::bigint)) as size
from storage.objects group by bucket_id;
```

## What you can and cannot see
- Normal chats are stored readable. The privacy promise is "not shown to anyone except a reported message".
- Secret chats: only scrambled text is stored. Nobody, including you, can read it.
- Throw Shade: the hidden sender is stored in the database so reports can be handled. Never share this table's contents.
- Never share your service_role key or database password with anyone, including an AI assistant.
