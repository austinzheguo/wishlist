# 想看清单 2026：运行、恢复与迁移

## 现行状态（迁移未验收）

- 旧站：[https://austinzheguo.github.io/wishlist/](https://austinzheguo.github.io/wishlist/)。它仍是 GitHub Pages 静态网页，连接 Supabase 项目 `wishlist2026`；其 RLS 虽启用，但匿名策略目前仍允许指定清单读写。因此旧站**不是私有入口**。
- 目标站：[https://wishlist.orbitspaces.top](https://wishlist.orbitspaces.top)。只读预览已部署，浏览器确认到达 Cloudflare OTP 页；登录验收仍待所有者。架构为 Cloudflare Access 邮件 OTP（沿用原所有者身份）→ Orange Tunnel（`cloudflared` 与应用均验证 JWT）→ 独立、loopback-only 容器 → `/var/lib/wishlist` 中的 SQLite。此预览导入的是迁移快照；正式写入前必须冻结旧匿名写并再取最终快照。
- 目标容器资源上限：256 MiB 内存、0.5 CPU。运行目录与 Hermes/GEL 数据目录分离；不重启主机、Docker daemon 或无关服务。
- 目标浏览器不保存清单到 localStorage。未同步稿仅作标签页会话恢复；必须先登录并读取服务器当前 revision，先下载恢复稿，再显式读取最新版。登录过期/退出会清空恢复稿与当前页面数据。切后台、BFCache 返回时隐藏私有页面并重新请求验证。

## 日常操作

- 看到数据库暂不可用时使用页面“重试”；失败 UI 不要求清单密码。
- 页面顶部同步状态显示等待、同步中、成功、失败或冲突。同步失败时不要刷新，先导出备份；跨设备冲突先下载恢复稿，再读取服务器最新版。
- 删除后可在 60 秒内撤销；撤销状态保存在私有 SQLite，不写入浏览器持久存储。
- 迁移验收完成前，旧 GitHub Pages 仍公开可读写。避免在切换期间于新旧站同时编辑。

## 迁移切换门槛

1. 源核验：原 Supabase 项目健康；`wishlist_items` 与 `wishlist_data.data.items` 字段级一致；记录 revision、时间戳、RLS 与策略摘要。只读校验不改原库。
2. 目标预览：在新站配置 owner-only OTP、Tunnel JWT 校验和 SQLite 后，先完成合成数据、安全检查；所有者完成真实登录和清单验收。预览保持只读，旧端仍是唯一写端和回退基线。
3. 最终单写窗口（新端首次正式写入前）：短时冻结旧匿名写/RPC，重新导出最终源快照，逐字段导入并比较条目摘要、cover 偏好与 revision；确认目标端是唯一写端后再开放其写入。冻结前不得把预览用户验收误当成切换完成。
4. 用户验收：所有者亲自完成邮件 OTP，确认展示的清单数量、同步状态及关键交互；遇到内容差异则停止切换并回退，不能自动合并。
5. 验收通过后，撤销旧 Supabase 全部匿名读写策略及匿名 RPC 权限，并停止旧 Pages 应用入口；原数据保留，不删项目/表/数据。验证旧地址与匿名 REST/RPC 不再返回清单内容。

## 备份和恢复

- Orange 上 Wishlist 专属 systemd timer 每日约 03:20 UTC 启动独立 backup 容器，保留最近 14 份；每次执行 SQLite integrity check 与流式 SHA-256。首次备份和隔离恢复已验证；轮转需要随定时执行继续观察。
- 分开记录三项：Orange VPS 本地滚动备份、当前 Mac Git 外受限目录中的首份人工副本及隔离恢复验证、未来自动异机同步（尚未配置）。VPS 与 Mac 的人工副本是不同设备，但单份人工复制不等于自动异机备份服务。
- 私有 JSON/SQLite/WAL/SHM/备份和迁移数据均不得提交 Git；`.gitignore` 与 `.dockerignore` 应保持覆盖这些路径。

## 开发与发布

1. 从仓库 `main` 更新后在独立分支修改。
2. 运行 `node --test test/*.test.mjs`、Node 语法检查、`git diff --check`，并检查访问控制、隐私路径、容器限制和备份恢复行为。
3. 逐项审核 `git diff`，确认无清单 JSON、SQLite 文件、访问邮箱、token、密码、publishable/service key。
4. 提交并推送审阅分支；独立审阅通过、用户登录验收和阶段门槛满足后才切换生产。

## Supabase 历史结构（只读回退基线）

- `supabase/003_add_wishlist_revision.sql` 增加版本号用于冲突检测。
- `supabase/004_normalize_wishlist_items.sql` 把清单拆为 `wishlist_items`，并保留 `wishlist_data` 兼容快照；原 RPC 为 `replace_wishlist_items(uuid, bigint, jsonb)`。
- 当前迁移任务不对原库执行 schema/RLS 修改；匿名写入冻结和最终匿名访问撤销只按上面的分阶段门槛进行。
