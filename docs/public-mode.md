# 历史公开模式（已退役）

本文件记录迁移前的 Supabase 公开模式。自 2026-10-06 起，旧 GitHub Pages 已关闭，原 Supabase 项目保留但匿名表授权、匿名 RLS 策略和匿名 RPC 权限均已撤销。不要照此文件重新开放匿名访问，也不要把旧站恢复为生产入口。

当前私有入口与权限状态见 [运行与恢复说明](operations.md)。

## 已退役配置摘要

- 历史客户端使用 `accessMode: "public"`；相关公开 UID 与匿名策略仅供理解旧架构，不再代表线上有效授权。
- 现行撤权脚本见 [supabase/005_revoke_anonymous_access.sql](../supabase/005_revoke_anonymous_access.sql)。不要重跑 `002_enable_public_document.sql` 恢复旧匿名访问。

## 历史配置脚本（禁止作为恢复步骤执行）

1. 历史上曾运行 `supabase/001_create_wishlist_data.sql`，创建表、启用 RLS，并保留密码模式的用户归属规则。
2. 历史上曾在 Supabase 的 **Authentication** → **Users** 中确认清单账号的 UID。
3. `supabase/002_enable_public_document.sql` 是已退役的历史脚本；执行会重新开放匿名访问，当前不得运行。
4. 历史上曾在 **Database** → **Policies** → `wishlist_data` 与 `wishlist_items` 中确认以 `Anonymous visitors` 开头的规则；这些规则现已撤销。

## 旧版前端配置（勿恢复）

旧版 `index.html` 曾将 `SUPABASE_CONFIG` 设置为：

```js
accountEmail: "",
accessMode: "public",
publicDocumentUserId: "清单账号的 UID"
```

`url` 与 `publishableKey` 可保留在静态网页中；绝不能填写 service_role、secret key、数据库密码或账号密码。

## 需要变更权限时

不要使用本历史说明推断当前数据库状态。先审阅当前项目状态、经审批的 SQL migration 与恢复备份；不得重跑匿名开放脚本。原始数据仍保留在 Supabase，但不作为当前应用写端。
