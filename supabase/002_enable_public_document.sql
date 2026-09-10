-- 第 2 步（当前线上配置）：允许未登录访客查看和修改“指定的一份”清单。
-- 本文件保留实际执行的公开文档 UID，供日后审计和重新部署时核对。
-- UID 不是密码；它只指定可被匿名访问的那一行。不要在本文件写入 service_role、secret key、数据库密码或账号密码。
-- 当前项目已经执行过此配置；日常维护不要重复运行。仅在重新部署或明确调整公开权限时使用。

begin;

alter table public.wishlist_data enable row level security;

-- 给未登录访客访问这一张表所需的最小操作权限。
grant select, insert, update on table public.wishlist_data to anon;

drop policy if exists "Anonymous visitors read public wishlist" on public.wishlist_data;
create policy "Anonymous visitors read public wishlist"
  on public.wishlist_data for select to anon
  using (user_id = '68ba3650-8d11-412e-be8b-e32a215fbb90'::uuid);

drop policy if exists "Anonymous visitors create public wishlist" on public.wishlist_data;
create policy "Anonymous visitors create public wishlist"
  on public.wishlist_data for insert to anon
  with check (user_id = '68ba3650-8d11-412e-be8b-e32a215fbb90'::uuid);

drop policy if exists "Anonymous visitors update public wishlist" on public.wishlist_data;
create policy "Anonymous visitors update public wishlist"
  on public.wishlist_data for update to anon
  using (user_id = '68ba3650-8d11-412e-be8b-e32a215fbb90'::uuid)
  with check (user_id = '68ba3650-8d11-412e-be8b-e32a215fbb90'::uuid);

commit;
