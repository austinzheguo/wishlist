# 想看清单 / 想玩档案

一个面向个人使用的中文愿望清单，用来管理书、动漫、电影、电视剧、游戏和纪录片。

旧 GitHub Pages 地址 https://austinzheguo.github.io/wishlist/ 已于 2026-10-06 退役，现返回 404；仓库源码仍保留。

当前私有站地址：https://wishlist.orbitspaces.top

## 当前状态

- 当前入口：Cloudflare Access 本人 Google 登录＋原所有者邮件 OTP 备用→ Orange Tunnel（边缘及 Tunnel 两侧验证 Access JWT）→ VPS loopback 上独立 Node/SQLite 容器。本人已在内置浏览器和 Chrome 完成 OTP 与 57 条清单验收。
- 2026-10-07 用户确认手机正常使用，手机补测通过（用户报告）。
- 原 Supabase 项目及 57 条数据保留；匿名表授权、匿名 RLS 策略和 anon/PUBLIC RPC 执行权限均已撤销，两表 RLS 仍开启。它不再是应用写入回退端。
- 目标数据目录为 `/var/lib/wishlist`，与 Hermes/GEL 数据目录隔离；容器限制为 256 MiB 内存、0.5 CPU。
- 旧站发布与 Supabase 匿名 API 已退役；正式 SQLite 数据与所有本地私密备份都不进入 Git。

## 技术架构

当前正式架构：浏览器 → Cloudflare Access → Orange Cloudflare Tunnel → wishlist-private 容器 → SQLite（持久卷）

已退役的历史架构：GitHub Pages → 原 Supabase（`wishlist_items` + `wishlist_data` + `replace_wishlist_items`）。

程序没有使用框架或构建工具；HTML、CSS 和 JavaScript 都在 index.html 中。

## 数据与安全

- 新版源码不再包含 Supabase publishable key、用户 ID、内置清单种子或封面名称映射；也不把清单持久化到浏览器 localStorage。
- 绝不能把 Supabase 的 service_role / secret key、数据库密码、Cloudflare API token、Access 邮箱或清单导出写入本仓库。
- 运行时私有数据库、SQLite WAL/SHM、备份与迁移文件已列入 `.gitignore` 和 `.dockerignore`。
- 旧 GitHub Pages 已关闭；原 Supabase 数据仍保留，但匿名 API 已撤权。
- 同一页面的连续修改会按顺序同步，页面顶部会显示等待、同步成功或失败状态。
- 页面顶部会显示最近一次成功同步的时间；页面重新打开后会读取云端记录的同步时间。
- 当另一台设备或页面已先修改云端时，旧页面不会覆盖它；页面会提示“跨设备冲突”，把本机修改保留为可下载备份，并可选择读取最新版云端清单。
- 目标站未同步草稿仅在当前标签页的 `sessionStorage` 暂存；刷新后必须先验证身份并读取最新 revision，显示冲突恢复层，不会自动用旧稿覆盖。
- 目标站退出或 Access 会话过期时清空页面中的私有条目、搜索内容和会话草稿；从后台恢复或 BFCache 返回时先隐藏并重新请求认证/数据。
- 删除条目后可在 1 分钟内撤销；新版撤销状态由 SQLite 保存，不写浏览器持久存储。

## 本地开发与发布

正式开发目录应当通过 GitHub 仓库 clone 获得。发布流程（只在新站验收后适用）：

1. git pull 获取最新版本。
2. 修改 index.html。
3. 运行 `node --test test/*.test.mjs`，并核验 HTML/JS 与本地浏览器行为。
4. 用 git diff 检查改动。
5. 提交并推送审阅分支；不得包含私有运行数据。
6. 经独立审阅后按 Wishlist 专用发布流程部署容器；GitHub Pages 已关闭，不再作为发布目标。

不要直接把旧资料目录中的文件上传到 GitHub；以 clone 得到的项目目录为准。

## 备份

维护 Orange 上的 SQLite 滚动备份与 Mac Git 外受限目录中的人工异机副本；迁移临时快照仅用于一次性字段校验，并保持在权限为 0700/0600 的临时路径。不得将任何清单备份提交 Git。

目标端本地滚动备份为 14 份，含完整性检查、逐流 SHA-256 与独立恢复验证。切换后 SQLite 备份已复制到当前 Mac 的 Git 外受限目录并隔离恢复验证；这是人工异机副本，不代表已配置自动同步。

人工异机副本不代表自动云端同步；任何新增备份目的地都须另行评估隐私与恢复能力。

## 项目结构

index.html       # 唯一正式网页源码
README.md        # 项目概览
docs/            # 操作与维护说明
supabase/        # 数据库结构、权限与迁移脚本

开发过程记录见 [docs/development-log.md](docs/development-log.md)，包括已完成版本、后续计划和协作注意事项。

## 已知限制

- 新私有站经 Cloudflare Access 保护；海外网络路径可能较慢。
- GitHub Pages 旧站已退役。原 Supabase 项目保留但匿名 API 已撤权；如需恢复历史端，先制定并审阅新的安全方案，不能重跑旧公开模式脚本。
- Orange VPS 滚动备份与 Mac Git 外受限副本均已独立校验；未来自动同步未配置，单次人工复制不代表自动异机备份服务。
