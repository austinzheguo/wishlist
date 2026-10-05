# 开发日志与后续计划

这个文件记录“想看清单”项目已经完成的整理、后续准备做的改进，以及每项工作可能遇到的技术问题。它是项目的开发备忘，不替代 `README.md`、日常操作说明或 Supabase 迁移脚本。

## 2026-10-06 · 正式单写切换（当前）

- 用户在 Codex 内置浏览器与外部 Chrome 完成 Access 邮件 OTP，亲自确认桌面清单 57 条完整并明确授权切换；手机补测延期，仍是待办。
- 冻结旧匿名写/RPC 后最终核验 Supabase 原项目：`wishlist_items` 和 `wishlist_data.data.items` 均 57 条、revision 19、字段级差异 0；SQLite 逐条字段摘要与源一致，6 项封面偏好摘要也一致。
- 新 SQLite 已成为唯一应用写端。正式开写后只用一个明确标记的合成条目做桌面新增/同步/删除验收；测试条目已移除，活动列表回到 57 条、偏好不变，删除撤销数据已过期清空。因真实 smoke test，SQLite revision 当前为 21；旧 Supabase revision 19 与原数据仍保留。
- 原 Supabase 未删除项目、表、数据或 RPC。匿名对两表的全部表授权和 7 条匿名 RLS 策略已撤销；RLS 仍开启，7 条 authenticated policies 保留；RPC 仍为 `SECURITY INVOKER`，anon/PUBLIC EXECUTE 均关闭。匿名 REST 对两表 GET/POST 及 RPC POST 实测均返回 401。
- GitHub Pages 发布配置已删除，仓库及源码保留；原 URL 实测 404。新私有站未登录根页和 API 均 302 转入 Access；已登录桌面页同步状态正常、显示 57/57。
- Wishlist 专属容器健康；资源限额仍为 256 MiB / 0.5 CPU，本次 idle 快照约 20.44 MiB、CPU 0.00%。Docker、sing-box、Hermes Dashboard、Cloudflare Tunnel 均 active，`hermes-austin` 仍运行；没有重启其他服务。
- 切换后 Orange 滚动备份服务成功生成 SQLite 备份；Mac Git 外受限目录的新副本 mode 0600，父目录 0700。Orange 与 Mac 哈希一致，57 条、revision 21；在新建隔离临时目录恢复副本并通过 SQLite integrity/readback，之后清理临时恢复目录。自动异机同步仍未配置。
- 本节为当前状态；下节 2026-10-05 预览阶段记录保留为当时证据，不代表现在仍只读或匿名开放。

## 2026-10-05 · 私有化迁移预览阶段记录（历史）

- 迁移目标：Orange VPS 私有容器（Node + SQLite）和 Cloudflare Access 邮件 OTP。只读预览已部署于 `https://wishlist.orbitspaces.top`；Cloudflare 登录页已由浏览器确认可达，尚待所有者完成 OTP 与清单验收。旧站仍是唯一写端。
- 原 Supabase 项目 `wishlist2026` 当前为健康状态；只读核验确认两表 RLS 仍启用、公开策略原样存在，RPC `replace_wishlist_items(uuid, bigint, jsonb)` 存在且不是 `SECURITY DEFINER`。
- 源表与兼容文档快照字段级一致；当前快照计数 57，revision 19。通过网页导出的本地保护快照完成真实数据临时导入/readback，条目摘要 SHA-256 相同；cover 偏好随迁移一并校验。未修改原项目数据或策略。
- 新版已移除 Supabase 客户端配置、内置清单种子/封面映射和浏览器 localStorage 写入；Cloudflare Access JWT 在 `cloudflared` 与应用两侧验证，目标持久路径设计为 `/var/lib/wishlist`。
- 合成前端、API、认证、幂等、只读预览、备份恢复和迁移字段严格校验共 16 项测试通过。更新后 VPS 容器健康，loopback 未认证页面/API 均返回 401；空闲约 17.82 MiB / 256 MiB，CPU 约 0.05%，未 OOM。Docker、sing-box、Hermes Dashboard、Cloudflare Tunnel systemd units 均 active；`hermes-austin` 仍 running，未重启任何既有服务。修复刷新时短暂误显示“数据库不可用”的状态文案：加载中显示“正在加载清单”，只有 API 错误才显示可重试故障卡片。
- 有界资源峰值实测：同一已部署镜像、256 MiB / 0.5 CPU、`network none`，使用标记的备份副本及进程内合成 JWT 完成 HTML/data 读取、57 条同内容保存、幂等重试和读回；摘要一致，645,819-byte 保存请求成功。进程 RSS 采样峰值 96,432,128 bytes（约 92 MiB），cgroup `memory.peak` 47,521,792 bytes（约 45 MiB），cgroup CPU 用量 311,062 µs，exit 0 / OOM false。宿主可用内存前后约 4.17 / 4.10 GiB。测试容器与一次性副本已清理；生产库复核仍为 57 条、revision 19、源摘要一致。该结果是隔离副本实测，不代表真实浏览器/网络写入验收。
- Orange 本地滚动备份与 Mac Git 外 `~/Library/Application Support/Wishlist2026/backups/` 首份副本均验证为 57 条、revision 19；隔离副本 `integrity_check=ok`，三处 SHA-256 一致。未来自动异机同步未配置。
- Orange 已启用 Wishlist 专属每日 03:20 UTC systemd 备份 timer（随机延迟最多 10 分钟），下次计划 2026-10-06 03:21 UTC；systemd oneshot 手动验收成功（exit 0），目前已有两份已核验滚动快照，未来轮转尚待定时运行积累验证。
- Cloudflare 独立 Access 应用仅允许原 owner 邮箱 + 原一次性验证码身份提供方；Tunnel 路由通过 JWT 严格校验且保留 Hermes 前后路由及 404 fallback。DNS 已代理；用户报告内置浏览器与 Chrome 均完成 OTP 登录且页面正常。手机暂时无法测试，清单条目数量/完整性尚待确认。
- 加载提示修复已部署并仅重建 Wishlist 容器；需要在已登录浏览器刷新后复验最新版本状态。
- 正式切换门槛：先完成只读预览登录验收；然后短时冻结旧匿名写/RPC、重新导出最终源快照并导入/核验，之后才把新端改为唯一写端。验收前保留旧端回退基线；最终验收后才关闭旧匿名读取并退役 Pages。未来自动异机同步另行规划。

## 原始项目基线（历史记录）

- 项目地址：[GitHub 仓库](https://github.com/austinzheguo/wishlist)
- 线上地址：[GitHub Pages](https://austinzheguo.github.io/wishlist/)
- 历史架构：GitHub Pages 托管单文件 `index.html`，Supabase 逐条保存清单并保留兼容快照。
- 截至 2026-10-05 的历史模式为公开可编辑；之后已完成退役，不代表当前状态。
- 安全边界：service_role / secret key、数据库密码、访问邮箱和个人清单数据绝不进入源码或 Git。

## 已完成记录

### v1.0.0 · 项目整理与可维护性基础

- 补充 README、日常操作说明和公开模式说明。
- 将 Supabase 建表与公开文档权限变更保留为有顺序的 SQL 留痕：
  - `001_create_wishlist_data.sql`：创建数据表、启用 RLS 和基础规则。
  - `002_enable_public_document.sql`：为当前公开文档增加匿名访问规则。
- 增加 `.gitignore`，至少忽略 `.DS_Store`。
- 明确 clone 得到的仓库是唯一正式开发目录，旧目录只作为历史资料。
- 建立导出 JSON 备份和 Git 版本管理习惯。

### v1.1.0 · 跨设备修改冲突提醒

- 增加 `revision` 版本号和条件更新。
- 页面发现云端已被其他设备或页面更新时，不再用旧页面覆盖云端。
- 保留本机修改为可下载的冲突备份，并允许读取最新版云端清单。
- 数据库留痕见 `supabase/003_add_wishlist_revision.sql`。

### v1.2.0 · 删除恢复与同步可见性

- 删除后提供 60 秒“撤销删除”按钮。
- 刷新页面后，只要倒计时尚未结束，撤销入口仍会恢复。
- 页面显示“最近一次成功同步时间”。

### v1.2.1 · 表格类型标签修复

- 修复表格视图中类型标签文字与背景对比不足、看起来像深色空框的问题。
- 让表格类型标签可以独立应用类型颜色，不依赖卡片外层样式。

### v1.3.0 · 手机与日常使用体验

- 记住搜索、状态/类型筛选、快捷筛选、排序方式、排序方向和卡片/表格视图。
- 增加快捷筛选：最近 30 天新增、只看有备注、只看未评分。
- 失效封面显示统一的 🖼 备用图标。
- 增加手机窄屏布局，顶部操作会自动换行，表格在窄屏下可横向滚动。
- 编辑、删除确认和冲突弹窗增加自动聚焦，以及关闭后返回原操作按钮的焦点管理。
- 当前版本提交：`0f621c4`；标签：`v1.3.0`。

### v1.4.0 · 清单条目规范化存储

- 新增 `supabase/004_normalize_wishlist_items.sql`。
- 将原来 `wishlist_data.data.items` 中的 47 条条目迁移到 `wishlist_items`，每个条目独立一行。
- 保留 `wishlist_data` 作为兼容快照和回退备份，未删除原有数据。
- 前端读取逐条记录，并通过 `replace_wishlist_items` 在事务中完成版本校验、保存和快照更新。
- v1.4.0 当时暂时保留公开读写权限，便于先完成结构迁移；2026-10-06 已在 005 中撤销匿名访问。
- 已验证：新旧条目数量均为 47；错误版本号会返回冲突且不改数据；公开 Data API 可以读取新表。

## 后续计划

### P1：封面检索与候选选择

这是来自 ChatGPT 对话“讨论项目优化”的明确计划。本轮只记录，不直接开发：

[查看原对话](chatgpt-conversation://6aa25b30-17c0-83e8-aa99-515540c3e0f4)

目标是在“添加想看”与“编辑”弹窗的封面区域增加“搜索封面”入口。根据标题，必要时结合类型、作者、平台，返回多张候选封面，由用户确认后写入现有 `cover` 字段；不能默认采用第一张结果。

建议分阶段实现：

1. 先接入 Open Library，验证书籍搜索、作者匹配和封面 URL 写入。
2. 再接入 TMDB，用于电影、电视剧、纪录片和部分动漫。
3. 最后评估游戏来源（IGDB 或 RAWG），加入平台信息和更严格的同名结果确认。
4. 将不同来源统一成同一套候选结果格式，在弹窗中展示封面、标题、作者/年份、来源和外部链接。
5. 用户点选后只更新当前 `draft.cover`，保存条目时沿用现有同步与冲突保护。
6. 增加加载中、无结果、网络失败、来源限流和取消搜索状态；保留上传、粘贴和图片网址作为备用方式。

可能棘手的地方：

- GitHub Pages 是静态网页，不能把 TMDB、IGDB 或 Twitch 的 secret 写入 `index.html`。
- IGDB 需要 Twitch Developer 应用和 OAuth，且不适合由浏览器直接调用；通常需要 Supabase Edge Function 代理。
- TMDB 需要申请 API 凭证，并要处理图片地址、来源署名和接口使用限制。
- Open Library 虽然基础搜索不需要 token，但需要处理同名书、不同版本、无封面和访问频率限制。
- 第三方服务的结果结构、语言、地区和网络可用性不一致，需要统一错误处理和候选排序。
- Edge Function Secrets、CORS、函数部署和第三方凭证申请需要人工在 Supabase/Twitch/TMDB 后台配合；这些凭证不能交给 Git 或写进聊天记录。
- 公开可编辑模式下，搜索接口还要考虑匿名调用滥用、限流和成本边界，不能因为新增功能而放宽数据库权限。

### P2：批量操作

- 先增加条目选择框和“已选数量”提示。
- 批量修改状态应使用明确的二次确认，并显示影响条数。
- 批量删除必须复用现有 60 秒撤销机制；需要决定多条撤销的数据结构和冲突处理方式。
- 这项功能会显著改变误操作风险，建议在独立版本中实现和测试。

### P3：继续打磨日常体验

- 根据实际手机使用反馈调整顶部按钮、快捷筛选和表格横向滚动。
- 继续完善弹窗键盘操作，例如 Tab 焦点循环、屏幕阅读器提示和更明确的关闭原因。
- 统一检查失效封面、网络失败、空筛选结果和同步冲突时的提示语。
- 评估是否增加更细的快捷筛选，例如“最近更新”“有封面”和“未设置优先级”。

## 每次开发的协作流程

1. 先在本日志登记目标、范围和不做的事情。
2. 检查当前工作目录、`git status`、远程地址和文件列表。
3. 修改前确认是否涉及 Supabase；涉及数据库、Edge Function、Secrets 或权限时，先备份并单独记录迁移步骤。
4. 只在正式 clone 仓库中修改，先看 `git diff`，再做语法、交互和安全检查。
5. 如果需要人工介入，明确列出要复制的 SQL、要申请的凭证、要填写的配置和验证结果；不要求用户提供 secret 内容。
6. 完成后提交并推送，等待 GitHub Pages 部署，再检查线上页面；数据库变更则另外核对 Supabase 实际结果。
7. 稳定版本再打标签，并在本日志补充版本号、提交号和已知限制。

## 当前暂不做

- 不恢复密码模式，不修改当前公开可编辑策略。
- 不把第三方 secret、Twitch 密码、OAuth token 或数据库密码放入网页源码、README、SQL 或 Git。
- 不因为封面搜索而直接修改现有 `cover` 字段以外的数据结构。
- 不在没有候选确认和撤销方案前自动选用搜索结果第一张封面。
