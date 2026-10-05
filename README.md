# 想看清单 / 想玩档案

一个面向个人使用的中文愿望清单，用来管理书、动漫、电影、电视剧、游戏和纪录片。

当前旧站地址（迁移验收完成前仍是旧公开站）：https://austinzheguo.github.io/wishlist/

目标私有站地址：https://wishlist.orbitspaces.top（只读预览已部署；需所有者完成 OTP/内容验收后，才进入单写切换）。

## 当前状态

- 迁移未完成时：旧入口仍为 GitHub Pages，原 Supabase 项目启用匿名读写；任何知道旧网址的人都可能查看、修改或删除内容。
- 迁移目标：Cloudflare Access 邮件一次性验证码（仅原所有者）→ Orange Tunnel（边缘及 Tunnel 两侧验证 Access JWT）→ 绑定到 VPS loopback 的独立 Node/SQLite 容器。
- 目标数据目录为 `/var/lib/wishlist`，与 Hermes/GEL 数据目录隔离；容器限制为 256 MiB 内存、0.5 CPU。
- 旧端匿名写入冻结、最终快照切换、旧端匿名读取撤销与 GitHub Pages 退役，均须按迁移验收门槛分阶段完成。验收前不要把旧地址当作私有站使用。

## 技术架构

迁移目标：浏览器 → Cloudflare Access → Orange Cloudflare Tunnel → wishlist-private 容器 → SQLite（持久卷）

当前回退基线：GitHub Pages → 原 Supabase（`wishlist_items` + `wishlist_data` + `replace_wishlist_items`）。

程序没有使用框架或构建工具；HTML、CSS 和 JavaScript 都在 index.html 中。

## 数据与安全

- 新版源码不再包含 Supabase publishable key、用户 ID、内置清单种子或封面名称映射；也不把清单持久化到浏览器 localStorage。
- 绝不能把 Supabase 的 service_role / secret key、数据库密码、Cloudflare API token、Access 邮箱或清单导出写入本仓库。
- 运行时私有数据库、SQLite WAL/SHM、备份与迁移文件已列入 `.gitignore` 和 `.dockerignore`。
- 当前旧站尚未完成私有化；其 Supabase RLS 虽启用，但匿名策略仍允许指定清单读写。
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
6. 经独立审阅及部署门槛后更新 Cloudflare 配置，并在新的私有站完成真实 Access 登录与读写验收。

不要直接把旧资料目录中的文件上传到 GitHub；以 clone 得到的项目目录为准。

## 备份

迁移期间维护两种不同备份：本地迁移快照（逐字段校验，保持在权限为 0700/0600 的临时路径）以及目标 SQLite 完整备份。不得将任何清单备份提交 Git。

目标端本地滚动备份为 14 份，含完整性检查、逐流 SHA-256 与独立恢复验证。迁移首份受保护副本计划复制到当前 Mac 的 Git 外受限目录并隔离恢复验证；这是人工首份副本，不代表已配置自动异机同步。未来自动同步仍需单独规划与验证。

建议文件名：

wishlist-backup-YYYY-MM-DD.json

并保存到至少两个位置，例如电脑本地和云盘。

## 项目结构

index.html       # 唯一正式网页源码
README.md        # 项目概览
docs/            # 操作与维护说明
supabase/        # 数据库结构、权限与迁移脚本

开发过程记录见 [docs/development-log.md](docs/development-log.md)，包括已完成版本、后续计划和协作注意事项。

## 已知限制

- GitHub Pages 和 Supabase 都是海外服务，国内未使用代理时可能无法访问或较慢。
- GitHub Pages 旧站当前仍为匿名可读写；在用户完成新站登录和数据验收前，不撤销旧站回退路径。
- Orange VPS 滚动备份、本机受限目录中的迁移首份副本、未来自动同步分别验收；单次 Mac 副本不是自动异机备份服务。
