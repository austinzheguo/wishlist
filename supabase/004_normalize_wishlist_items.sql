-- v1.4.0 数据结构迁移：将 wishlist_data.data.items 拆成逐条 wishlist_items。
-- 当前仍保持公开模式的读写权限，便于先完成结构迁移；后续可单独收紧 anon 的 UPDATE/DELETE。
-- 旧表 wishlist_data 保留为兼容快照与回退备份，不删除任何现有数据。

create table if not exists public.wishlist_items (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null default '书',
  title text not null,
  status text not null default 'want',
  priority smallint not null default 0 check (priority between 0 and 9),
  rating smallint not null default 0 check (rating between 0 and 9),
  note text not null default '',
  cover text not null default '',
  author text not null default '',
  lang text not null default '',
  platforms jsonb not null default '[]'::jsonb check (jsonb_typeof(platforms) = 'array'),
  created bigint not null,
  updated bigint not null
);

create index if not exists wishlist_items_user_updated_idx
  on public.wishlist_items(user_id, updated desc);

alter table public.wishlist_items enable row level security;

grant select, insert, update, delete on table public.wishlist_items to anon;
grant select, insert, update, delete on table public.wishlist_items to authenticated;

drop policy if exists "Anonymous visitors read public wishlist items" on public.wishlist_items;
create policy "Anonymous visitors read public wishlist items"
  on public.wishlist_items for select to anon
  using (user_id = '68ba3650-8d11-412e-be8b-e32a215fbb90'::uuid);

drop policy if exists "Anonymous visitors create public wishlist items" on public.wishlist_items;
create policy "Anonymous visitors create public wishlist items"
  on public.wishlist_items for insert to anon
  with check (user_id = '68ba3650-8d11-412e-be8b-e32a215fbb90'::uuid);

drop policy if exists "Anonymous visitors update public wishlist items" on public.wishlist_items;
create policy "Anonymous visitors update public wishlist items"
  on public.wishlist_items for update to anon
  using (user_id = '68ba3650-8d11-412e-be8b-e32a215fbb90'::uuid)
  with check (user_id = '68ba3650-8d11-412e-be8b-e32a215fbb90'::uuid);

drop policy if exists "Anonymous visitors delete public wishlist items" on public.wishlist_items;
create policy "Anonymous visitors delete public wishlist items"
  on public.wishlist_items for delete to anon
  using (user_id = '68ba3650-8d11-412e-be8b-e32a215fbb90'::uuid);

drop policy if exists "Users read own wishlist items" on public.wishlist_items;
create policy "Users read own wishlist items"
  on public.wishlist_items for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users create own wishlist items" on public.wishlist_items;
create policy "Users create own wishlist items"
  on public.wishlist_items for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own wishlist items" on public.wishlist_items;
create policy "Users update own wishlist items"
  on public.wishlist_items for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete own wishlist items" on public.wishlist_items;
create policy "Users delete own wishlist items"
  on public.wishlist_items for delete to authenticated
  using ((select auth.uid()) = user_id);

-- 只迁移尚未存在的条目，重复执行不会覆盖新表中已经确认的记录。
insert into public.wishlist_items
  (id, user_id, type, title, status, priority, rating, note, cover, author, lang, platforms, created, updated)
select
  coalesce(item->>'id', gen_random_uuid()::text),
  d.user_id,
  coalesce(nullif(item->>'type', ''), '书'),
  coalesce(item->>'title', ''),
  coalesce(nullif(item->>'status', ''), 'want'),
  greatest(0, least(9, coalesce((item->>'priority')::smallint, 0))),
  greatest(0, least(9, coalesce((item->>'rating')::smallint, 0))),
  coalesce(item->>'note', ''),
  coalesce(item->>'cover', ''),
  coalesce(item->>'author', ''),
  coalesce(item->>'lang', ''),
  case when jsonb_typeof(item->'platforms') = 'array' then item->'platforms' else '[]'::jsonb end,
  coalesce((item->>'created')::bigint, floor(extract(epoch from now()) * 1000)::bigint),
  coalesce((item->>'updated')::bigint, floor(extract(epoch from now()) * 1000)::bigint)
from public.wishlist_data d
cross join lateral jsonb_array_elements(coalesce(d.data->'items', '[]'::jsonb)) as expanded(item)
where coalesce(item->>'title', '') <> ''
on conflict (id) do nothing;

-- 前端保存时使用此函数，利用旧表的 revision 做条件更新，并在一个事务中重建逐条记录。
-- SECURITY INVOKER 保证函数仍受调用者的 RLS 权限约束；当前公开模式下 anon 可完整同步，
-- 未来收紧 anon 权限时应改用专门的“只追加”接口，而不是绕过 RLS。
create or replace function public.replace_wishlist_items(
  p_user_id uuid,
  p_expected_revision bigint,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_revision bigint;
  next_revision bigint;
  snapshot_items jsonb;
begin
  snapshot_items := coalesce(p_snapshot->'items', '[]'::jsonb);
  if jsonb_typeof(snapshot_items) <> 'array' then
    raise exception 'snapshot.items must be an array';
  end if;

  select revision into current_revision
  from public.wishlist_data
  where user_id = p_user_id
  for update;

  if current_revision is null then
    if p_expected_revision is not null then
      return jsonb_build_object('ok', false, 'reason', 'conflict');
    end if;
    current_revision := -1;
    insert into public.wishlist_data(user_id, data, revision, updated_at)
    values (p_user_id, p_snapshot, 0, now())
    on conflict (user_id) do nothing;
    select revision into current_revision from public.wishlist_data where user_id = p_user_id for update;
  elsif p_expected_revision is distinct from current_revision then
    return jsonb_build_object('ok', false, 'reason', 'conflict', 'revision', current_revision);
  end if;

  next_revision := case when current_revision < 0 then 0 else current_revision + 1 end;
  delete from public.wishlist_items where user_id = p_user_id;
  insert into public.wishlist_items
    (id, user_id, type, title, status, priority, rating, note, cover, author, lang, platforms, created, updated)
  select
    coalesce(item->>'id', gen_random_uuid()::text),
    p_user_id,
    coalesce(nullif(item->>'type', ''), '书'),
    coalesce(item->>'title', ''),
    coalesce(nullif(item->>'status', ''), 'want'),
    greatest(0, least(9, coalesce((item->>'priority')::smallint, 0))),
    greatest(0, least(9, coalesce((item->>'rating')::smallint, 0))),
    coalesce(item->>'note', ''),
    coalesce(item->>'cover', ''),
    coalesce(item->>'author', ''),
    coalesce(item->>'lang', ''),
    case when jsonb_typeof(item->'platforms') = 'array' then item->'platforms' else '[]'::jsonb end,
    coalesce((item->>'created')::bigint, floor(extract(epoch from now()) * 1000)::bigint),
    coalesce((item->>'updated')::bigint, floor(extract(epoch from now()) * 1000)::bigint)
  from jsonb_array_elements(snapshot_items) as expanded(item)
  where coalesce(item->>'title', '') <> '';

  update public.wishlist_data
  set data = p_snapshot, revision = next_revision, updated_at = now()
  where user_id = p_user_id;

  return jsonb_build_object('ok', true, 'revision', next_revision, 'updated_at', now());
end;
$$;

revoke all on function public.replace_wishlist_items(uuid, bigint, jsonb) from public;
grant execute on function public.replace_wishlist_items(uuid, bigint, jsonb) to anon, authenticated;
