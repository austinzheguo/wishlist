# 想看清单 2026：运行、恢复与迁移

## 现行状态（2026-10-06 正式切换）

- 旧入口：[https://austinzheguo.github.io/wishlist/](https://austinzheguo.github.io/wishlist/) 已关闭 GitHub Pages 发布；实测返回 404，仓库源码仍保留。
- 正式入口：[https://wishlist.orbitspaces.top](https://wishlist.orbitspaces.top)。Cloudflare Access 于 2026-10-07 增加本人指定 Google 登录（精确邮箱且必须匹配 Google IdP），原所有者邮件 OTP 备用保留；Orange Tunnel 与应用两侧均验证 Access JWT；WishList 独立 loopback-only 容器使用 `/var/lib/wishlist/wishlist.sqlite`。本人在内置浏览器与 Chrome 完成 OTP 和 57 条清单验收。
- 原 Supabase 项目 `wishlist2026` 保留，不删除表、行或项目。anon 对 `wishlist_items`、`wishlist_data` 的表权限及匿名 RLS 策略已撤销；两表 RLS 仍开启，7 条 authenticated 原策略保留。RPC 仍为 `SECURITY INVOKER`，anon 与 PUBLIC 均无 EXECUTE；匿名 REST 对两表读写和 RPC 实测均返回 401。
- 冻结后的 Supabase 源表与兼容快照均为 57 条、revision 19、逐字段差异 0；条目及封面偏好摘要与 SQLite 一致。桌面 smoke test 只用合成条目，新增后删除，原 57 条和 6 项封面偏好未变；测试写入使当前 SQLite revision 为 21，旧 Supabase revision 19 与原数据保留。
- 2026-10-07 用户确认手机正常使用，切换后手机补测通过（用户报告）。
- 目标容器资源上限：256 MiB 内存、0.5 CPU。运行目录与 Hermes/GEL 数据目录分离；不重启主机、Docker daemon 或无关服务。
- 目标浏览器不保存清单到 localStorage。未同步稿仅作标签页会话恢复；必须先登录并读取服务器当前 revision，先下载恢复稿，再显式读取最新版。登录过期/退出会清空恢复稿与当前页面数据。切后台、BFCache 返回时隐藏私有页面并重新请求验证。

## 2026-10-07 登录便利性调整

用户授权本人 Google 登录，原 OTP 备用保留。Cloudflare Google IdP 已接入，应用 allowed_idps 仅 Google 与原 OTP；新增 Google Allow 策略要求指定本人邮箱＋Google 登录方法同时匹配；原 OTP 策略未改。应用及两策略独立 API 读回通过。用户随后授权把 Google 策略会话延长至 720h（30 天），独立 API 读回通过；策略覆盖应用默认 24h。原 OTP 策略及身份限制未改。Google 会话到期可选 Google，通常复用浏览器 Google 登录，无需邮件验证码。已签发的旧会话不保证自动延长，必要时到期重登一次。

授权 URL scope 为 email profile openid，无 Gmail 读取权限；同一 IdP 的 Chrome 实际 Google 登录回调到 Hermes 看板通过。Wishlist 源码验证不依赖旧邮箱，只验证 Access JWT 签名、issuer、audience 和时效，无源站更改。匿名根入口/API 实测 302。Chrome 既有 Wishlist 会话实际读取数据库成功；当次页面显示 59 条（当前页面快照，非重新核对原 57 条数据）。2026-10-07 用户随后确认手机 Hermes 和 Wishlist 均可正常使用，手机实际使用验收通过（用户报告）。未逐项报告登录方式或增删改步骤，不单独追认这些分项，也不以此证明 30 天持续有效。

网络资产登录配置日志由 [Proxy Lab](https://github.com/austinzheguo/Proxy-Lab/blob/main/logs/2026-10-07-access-login.md) 维护。OAuth 密钥、完整账号、清单内容和私有配置不入 Git。回退时移除新增 Google 策略并恢复应用仅 OTP，原 OTP 策略和源站数据均保留。

## 2026-10-08 Chrome 登录误过期修复

实际复现：Chrome 页面显示“登录已过期”，点击“重新验证”加载后又立即回到过期状态。Google Access 会话已设为30天，但前端直接把剩余有效期作为 setTimeout 延迟；超过2147483647毫秒（约24.9天）时浏览器定时器溢出，错误触发页面过期清除。相关限制见[MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#maximum_delay_value)。

改为按绝对 expiresAt 分段等待，每段不超过定时器上限，到点重新检查；保持真正到期/401的私有数据清除和重新认证路径。不调整Access权限、Google/OTP策略、30天有效期或源站认证。新增30天计时及真实/非法到期边界测试，全套18项通过。部署前现有SQLite备份成功；仅替换网页并重建Wishlist容器，数据库挂载不变，Hermes未重启；线上文件摘要与提交源码一致，容器healthy。

Chrome两个原有标签页刷新后均显示“已从私有数据库读取”，appShell可见、过期层隐藏；未执行清单增删改，未追认为30天持续使用验收。旧程序镜像及旧HTML保留在主机私有恢复目录；程序回退不覆盖数据库。主机临时部署脚本已清理。

## 日常操作

- 看到数据库暂不可用时使用页面“重试”；失败 UI 不要求清单密码。
- 页面顶部同步状态显示等待、同步中、成功、失败或冲突。同步失败时不要刷新，先导出备份；跨设备冲突先下载恢复稿，再读取服务器最新版。
- 删除后可在 60 秒内撤销；撤销状态保存在私有 SQLite，不写入浏览器持久存储。
- 当前只有私有 SQLite 是应用写入端；旧 Pages 已退役，Supabase 匿名入口已关闭。

## 切换验收记录

1. **数据门槛通过**：冻结匿名写/RPC 后，Supabase 源表与兼容快照均为 57 条、revision 19、逐字段差异 0；条目和封面偏好摘要与 SQLite 一致后才开放新端写入。
2. **单写通过**：目标容器 `READ_ONLY=false`；本人完成桌面 OTP；合成条目经真实新增、同步、删除后，活动清单恢复 57 条，撤销窗口过期并清空。
3. **旧 API 关闭通过**：匿名 direct REST GET/POST 两表及 RPC POST 均返回 401。仅撤销 anon 授权与匿名策略；保留数据、表、函数、RLS 和 authenticated 原策略。PUBLIC 函数执行权也确认关闭。
4. **旧入口退役通过**：GitHub Pages API 曾显示来源为 `main:/`、最近构建成功；随后只删除 Pages 发布配置，保留仓库源码；旧 URL 实测返回 404。
5. **手机补测通过**：2026-10-07 用户确认手机想看清单正常使用（用户报告）；未逐项列出增删改操作，不单独追认分项。

## 备份和恢复

- Orange 上 Wishlist 专属 systemd timer 每日约 03:20 UTC 启动独立 backup 容器，保留最近 14 份；本次切换后手动备份通过 integrity/hash 校验。轮转仍需随定时运行继续观察。
- 切换后 SQLite 备份已复制到 Mac Git 外受限目录；文件 mode 0600、目录 mode 0700。Mac 隔离副本 integrity/readback 通过，57 条、revision 21、哈希与 Orange 一致。未来自动异机同步尚未配置；人工复制不等于自动备份服务。
- 私有 JSON/SQLite/WAL/SHM/备份和迁移数据均不得提交 Git；`.gitignore` 与 `.dockerignore` 应保持覆盖这些路径。

## 开发与发布

1. 从仓库 `main` 更新后在独立分支修改。
2. 运行 `node --test test/*.test.mjs`、Node 语法检查、`git diff --check`，并检查访问控制、隐私路径、容器限制和备份恢复行为。
3. 逐项审核 `git diff`，确认无清单 JSON、SQLite 文件、访问邮箱、token、密码、publishable/service key。
4. 提交并推送审阅分支；独立审阅通过、用户登录验收和阶段门槛满足后才切换生产。

## Supabase 历史结构（数据保留，不作应用回退端）

- `supabase/003_add_wishlist_revision.sql` 增加版本号用于冲突检测。
- `supabase/004_normalize_wishlist_items.sql` 把清单拆为 `wishlist_items`，并保留 `wishlist_data` 兼容快照；原 RPC 为 `replace_wishlist_items(uuid, bigint, jsonb)`。
- 2026-10-06 已撤销 anon 对两表的全部表权限与旧匿名 policies，并从 anon/PUBLIC 撤销 RPC EXECUTE；authenticated 原策略、RLS、表、函数及数据仍保留。详细留痕见 `supabase/005_revoke_anonymous_access.sql`。
