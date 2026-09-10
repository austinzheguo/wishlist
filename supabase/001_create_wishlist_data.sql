-- 第 1 步（历史初始化留档）：创建 wishlist_data，并配置密码模式的基础规则。
-- 当前线上项目已执行第 2 步公开模式配置；请保留本文件用于追溯执行顺序。
-- 不要在当前生产项目的日常维护中重复运行；仅在重新部署新项目时按顺序执行。
-- 每个已登录用户只有一份自己的清单；RLS 会阻止其他用户读取或修改它。

create table if not exists public.wishlist_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"app":"wishlist","ver":1,"items":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.wishlist_data enable row level security;

revoke all on table public.wishlist_data from anon;
grant select, insert, update on table public.wishlist_data to authenticated;

drop policy if exists "Users read own wishlist" on public.wishlist_data;
create policy "Users read own wishlist"
  on public.wishlist_data for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users create own wishlist" on public.wishlist_data;
create policy "Users create own wishlist"
  on public.wishlist_data for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own wishlist" on public.wishlist_data;
create policy "Users update own wishlist"
  on public.wishlist_data for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
