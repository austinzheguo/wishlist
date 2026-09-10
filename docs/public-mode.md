# 公开模式（当前已启用）

公开模式下，任何知道网站地址的人都能查看、添加、编辑、删除这份清单。Supabase 后台、账号密码和其他表不会因此公开；但这份清单数据会开放给访客修改。

## 当前配置

- 当前线上网站已使用 `accessMode: "public"`，不需要登录。
- 当前配置使用的公开文档 UID 已记录在 `index.html` 与 [../supabase/002_enable_public_document.sql](../supabase/002_enable_public_document.sql)。UID 不是密码，可以公开。
- RLS 仍然启用；匿名访客只能访问此 UID 对应的单份 `wishlist_data` 数据。
- 日常使用不需要再次运行 SQL。运行 SQL 会改变 Supabase 项目设置，只应在重新部署或明确调整权限时进行。

## 历史配置步骤（仅重新部署时参考）

1. 先运行 `supabase/001_create_wishlist_data.sql`，创建表、启用 RLS，并保留密码模式的用户归属规则。
2. 在 Supabase 的 **Authentication** → **Users** 中，确认清单账号的 UID。
3. 复制 `supabase/002_enable_public_document.sql` 到 **SQL Editor**。该文件中的 UID 必须与上一步的清单账号 UID 一致；当前仓库中的值已对应当前线上项目。
4. 执行后，在 **Database** → **Policies** → `wishlist_data` 中确认存在 3 条以 `Anonymous visitors` 开头的规则。

## 前端配置

`index.html` 的 `SUPABASE_CONFIG` 在公开模式下应保持以下状态：

```js
accountEmail: "",
accessMode: "public",
publicDocumentUserId: "清单账号的 UID"
```

`url` 与 `publishableKey` 可保留在静态网页中；绝不能填写 service_role、secret key、数据库密码或账号密码。

## 以后恢复密码

恢复前先从网页导出 JSON 备份。此操作会修改 Supabase 权限和前端配置；不要在没有备份时进行。

1. 在 `index.html` 改回：`accessMode: "password"`、填回 `accountEmail`，并把 `publicDocumentUserId` 留空。
2. 在 Supabase 的 **Database** → **Policies** 删除 3 条 `Anonymous visitors ...` 规则，并在 SQL Editor 运行：

```sql
revoke all on table public.wishlist_data from anon;
```

3. 再提交 GitHub 变更。密码登录与原来的 3 条 `Users ... own wishlist` 规则仍然保留，不需要重建数据。
