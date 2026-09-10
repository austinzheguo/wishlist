-- 第 3 步（v1.1.0）：为单份清单增加乐观并发控制版本号。
-- 本迁移只新增 revision 列，不修改 data 内容、公开 UID 或现有 RLS 策略。
-- 现有记录会从 revision = 0 开始；前端随后仅在版本一致时保存。
-- 当前线上项目需执行一次。重复执行安全。

begin;

alter table public.wishlist_data
  add column if not exists revision bigint not null default 0;

commit;
