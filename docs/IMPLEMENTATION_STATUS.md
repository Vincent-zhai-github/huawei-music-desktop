# 实现进度

更新时间：2026-10-21。当前以 **Linux 真实 Electron 环境**完成共享 API、业务逻辑、页面和播放器验证；Windows/macOS 不阻塞开发，不使用 Wine 作为运行/验收依赖。不对外发布。2026-10-21 起在 Windows 11 本机完成 NSIS 构建、安装与启动验证（见 M6）。

## M0–M6

| 里程碑 | 状态 | 当前证据与剩余验收 |
|---|---|---|
| M0 工程与安全边界 | verified | 锁定依赖；`npm ci`、typecheck、134 项离线单测、构建通过。Linux Electron 验证 renderer 无 Node/通用 IPC、精确来源与导航限制；app.asar 白名单检查通过。 |
| M1 登录与播放 | in-progress | 历史本人扫码已在正式 Electron 完成 CAS → OAuth → 音乐会话 → 首批 50 首收藏，无写操作。当前 Linux 本地合成 MP3/FLAC 实测播放、seek、ended、页面切换不中断通过。**真实华为 CDN 音源 MP3/FLAC 在 Electron 全曲播放、可用系统 safeStorage 下重启恢复仍待验收**。当前系统 backend=basic_text，应用正确 memory-only。 |
| M2 音乐库只读 | in-progress | 收藏、个人歌单/详情、搜索、专辑/歌手、历史已实现；歌单/专辑有分页。新增收藏总数后台索引 + 滚动分页 + 失败重试 + 切页/位置保留。965 首合成库在正式主进程与真实 renderer 分别通过；**不是本人 960+ 首的本轮实测**。收藏/歌单只在网络失败时回退 5MB 有标记缓存；400 不误判失效。 |
| M3 播放器日用能力 | in-progress | 单 Audio、顺序/随机/循环、音量/seek、音质选择、歌词高亮/手动滚动暂停跟随、队列恢复不自动播放。本轮补全歌词：解析词级 `<mm:ss.xx>` 逐字时间、同时间戳双语合并为翻译行、忽略 `[ti:][ar:]` 等元数据、主进程按曲缓存 LRC 结果；新增沉浸歌词页（点击行跳转、进度拖动、±0.5s 偏移按曲记忆、滚轮暂停跟随、Esc 退出）。设置同步、媒体键旧闭包与初始化队列竞态已修。965 首队列真实磁盘读回完整且无播放 URL。真实 CDN/听播、过期资源和睡眠恢复仍未验收。 |
| M4 受控写操作 | in-progress | 主进程串行写，收藏幂等读回；简介/删除先确认当前账号 owned，再读回核对。创建保留本次基线与未决意图，超时不重发，进程重启仍阻止盲目重复创建。生产业务集成测试使用合成响应通过。历史真实接口写验证及 added=0/removed=0 证据仍有效；**新桌面写路径没有当前授权下的真实写验收**。 |
| M5 视觉与系统集成 | in-progress | 视觉整体重做：浮起玻璃面板、窄侧栏、无边框内容、独立播放坞；配色与图标体系自定（暖白中性色 + 默认华为红）。CSS 变量化设计系统，960/1100 两档响应式。设置改为二级分类（播放/外观/关于），外观可调主题色、面板透明度、圆角、字号、字体，写入设置并实时生效。沉浸歌词改为左侧封面 + 右侧居中歌词。Linux Electron 实际截图覆盖 1180×760、960×640、歌词抽屉与沉浸歌词页、队列抽屉、965 首长列表。**新视觉未经用户最终确认，不宣称定稿**。托盘/关闭/媒体键有代码，物理媒体键、无托盘桌面及睡眠恢复仍待验。 |
| M6 发行工程 | in-progress | Linux x64 AppImage 已构建；从实际 AppImage 提取二进制并启动隔离 profile，核对打包文件与当前 out 一致、renderer 无 Node、设置可保存，全部通过。Windows 目标已按要求改为 **NSIS 安装包**，单文件 portable 构建入口、校验脚本与 CI 工作流已删除（`dist:win:portable`、`test:windows-portable`、`windows-portable.yml`）。2026-10-21 Windows 11 本机实跑：`dist:win` 构建成功（未签名），NSIS 静默安装到 per-user 目录成功，安装版启动 4 进程 + 主窗口正常；**CI runner 实跑与安装版登录/播放全流程仍未验收**。macOS arm64/x64 DMG 入口保留。deb 等待真实主页/维护者身份，不编造。 |

## UI 重做与歌词能力（2026-10-18）

- 视觉：`src/renderer/styles.css` 全量重写为 token 化设计系统（暖白中性色 + 单一华为红强调、圆角/阴影/间距/动效变量）。布局从「侧栏 + 通栏播放条」改为「浮起玻璃面板 + 独立播放坞」；列表加入封面缩略图、hover 播放按钮、当前行强调；设置页开关与下拉重绘；新增 `prefers-reduced-motion` 与 960/1180 两档断点。
- 借鉴边界：参考 Q-music 的布局语言与质感，未复制其色板（其主色为绿）、图标或组件实现，全部为本项目自写。
- 歌词解析（`src/lyrics.mjs`）：支持词级 `<mm:ss.xx>` 逐字标记、同一时间戳第二行合并为翻译、丢弃 `[ti:][ar:][al:][by:]` 元数据、纯文本歌词也保留逐字段；新增 6 项解析回归（共 11 项歌词单测）。
- 歌词来源降级：`resolvePlayback` 没有可用 `lyricAddress`、或地址拉取/解析为空时，改读响应内嵌的 `lyrics`（含 `contentExInfo` 与再套一层 JSON 的形态）；仍只接受华为 CDN 白名单地址，内嵌文本有 512KB 上限，新增 5 项 `lyric-resource` 单测。
- 歌词缓存：`AuthManager.getLyrics` 复用进程内 `memory-cache`（键 `lyrics:<trackId>`，账号切换/退出即失效）；renderer 另有一层按曲缓存，避免反复开关面板触发取链。
- 沉浸歌词页：全屏深色舞台 + 封面模糊背景，点击行 seek、进度条拖动、±0.5s 偏移（按曲存 `localStorage`，全局值兜底）、滚轮暂停跟随、Esc 退出；侧栏歌词抽屉保留并互斥于队列抽屉。
- 详情页：歌单/专辑/歌手新增封面 + 标题 + 主操作区（hero），取代原来的小标题行；歌单简介、删除确认、分页加载行为不变。
- 回归：typecheck、150 项离线单测、`test:electron`、`test:electron-ui`、`test:electron-business`、`test:electron-favorites` 全部通过；UI 测试仍覆盖歌词抽屉/队列互斥、播放与收藏写入。截图更新为 `docs/assets/{library,settings,favorites-total}.png`。

## 外观设置 / 歌词布局 / Windows 安装包（2026-10-18 第二轮）

- 沉浸歌词（`LyricsStage`）改为两栏：左侧封面 + 曲名/艺人/专辑，右侧歌词区域横向居中、当前行放大并保留逐字/翻译；底部仍是播放控制、进度、跟随与 ±0.5s 校正。
- 设置页拆成二级面板：`播放`（关闭行为、音质、模式、历史同步）、`外观`、`关于`；版本号常驻面板底部，`退出程序` 移到「关于」。
- 外观设置写入 `AppSettings.appearance`（`accent` / `panelOpacity` / `cornerRadius` / `fontScale` / `fontFamily`），`sanitizeAppearance` 做枚举校验与范围钳制（透明度 0.55–1、圆角 0–18px、字号 85%–120%），部分 patch 不会重置其它字段。renderer 通过 `document.documentElement` 上的 CSS 变量实时应用（`--accent*`、`--panel-alpha`、`--radius-unit`、`--fs-scale`、`--font-ui`）；设置页做乐观本地状态，连续拖动不丢步。
- 播放坞音量图标改为静音切换（记录上次可听音量）。
- 封面兜底：真实曲目封面来自 `picture.bigImgURL/middleImgURL/smallImgURL`（主域名 `music-pics-drcn.dbankcdn.cn` 等，均在 CSP 与队列持久化白名单内）；酷客部分封面仍是 `http://image.kuke.com`，会被 CSP 拦截，因此列表、播放坞、详情 hero 与歌词页统一使用带 `onError` 兜底的 `Cover` 组件，加载失败显示图标而不是破图。
- Windows 目标改为 **NSIS 安装包**：删除 `dist:win:portable`、`test:windows-portable`、`test:portable-data`、`windows-portable.yml`；新增 `dist:win`（仅原生 Windows）+ `test:windows-installer`（NSIS 标记、内嵌 x64 应用、无私有目录、图标像素、与 `out/` 逐文件一致）+ `windows-installer.yml`。**安装包尚未在 Windows runner 上实跑，安装/启动/播放未验收。**
- 回归：typecheck、152 项离线单测（新增外观 sanitize 与部分 patch 用例）、`test:electron`、`test:electron-ui`（新增外观改色/圆角/字体写盘与恢复默认断言）、`test:electron-business`、`test:electron-favorites` 全部通过。

## 第三方歌词 / 自定义外观 / 系统字体（2026-10-18 第三轮）

- 歌词兜底：服务端返回空歌词时，主进程按「歌名 + 艺人 + 时长」匹配第三方歌词库（酷狗 → LRCLIB）。纯函数 `lyrics-provider.mjs` 负责归一化与打分：标题非精确匹配时必须时长一致，艺人必须匹配，`MIN_SCORE` 以下一律拒绝，避免「安静下来」冒充「安静」。第三方结果带 `source`/`matchedTitle`，抽屉与沉浸页会标注来源；可在「设置 → 播放 → 第三方歌词匹配」关闭。实测（本机网络）：酷狗对《假如》《安静》《朵》《终有一天》《Bohemian Rhapsody》均命中；LRCLIB 华语覆盖较弱但英文可用。
- 自定义主题色：色板末尾增加原生取色器，`#rrggbb` 经 sanitize 校验，`theme.mjs` 从单个颜色派生 light/deep/soft/line/shadow。
- 系统字体：`fonts:list` 白名单 IPC，Windows 走 PowerShell + `System.Drawing.InstalledFontCollection`，Linux 走 `fc-list`；渲染进程用带搜索的字体列表（每项以自身字体渲染）选择，选择结果写入 `appearance.customFont` 并成为 CSS font-family 栈首项。Chromium 的 `queryLocalFonts()` 在 `file://` 文档下不可用，因此改为主进程枚举，main 窗口权限保持全拒。
- 回归：typecheck、170 项离线单测（新增 10 项歌词匹配、5 项主题色、2 项字体解析）、`test:electron`、`test:electron-ui`（新增自定义色写盘与 `fonts:list` 断言）、`test:electron-business`、`test:electron-favorites` 全部通过；`scripts/capture-ui.mjs` 增加系统字体与自定义色截图。

## 歌词磁盘缓存与本地导入（2026-10-18 第四轮）

- 磁盘缓存：`userData/lyrics-cache` 按曲目写入 JSON（sha256 键名、单文件上限 512 KB、TTL 90 天、超过 3000 个文件按 mtime 清理）。读取顺序为「本地导入 → 内存 → 磁盘 → 华为 → 第三方」，空结果不落盘，保证后续仍能重试。缓存不含账号信息，切换/退出账号不删除。
- 本地导入：`lyrics:import` 由主进程打开文件对话框，支持 `.lrc`/`.txt`，按 BOM 识别 UTF-16，UTF-8 校验失败回退 GBK；解析为空则报错不覆盖。导入内容写入 `userData/lyrics-local` 并优先于网络结果，歌词面板与沉浸页都可「移除本地」。
- 设置：`设置 → 播放` 显示缓存占用、网络条数、本地导入条数，提供「清除网络缓存」「清除本地导入」，清除后立即刷新数字。
- 回归：typecheck、176 项离线单测（新增 6 项歌词存储：GBK/UTF-16/UTF-8 BOM 解码、缓存文档校验、键稳定性）、`test:electron`（IPC 边界新增 `lyrics`）、`test:electron-ui`（真实文件导入 + 来源标注 + 缓存清除）、`test:electron-business`、`test:electron-favorites` 全部通过。

## 开源准备（README 重写）

- README 按开源项目结构重写：现状表（区分已实测/未验证）、截图（合成数据）、快速开始、功能范围与非目标、构建与打包（Windows 便携版 / Linux AppImage / macOS DMG / 交叉构建说明）、CI、测试、架构与安全边界、数据与隐私、已知限制、参与贡献、第三方组件、许可、免责声明。
- 原“Linux 内部构建 / Windows 单文件便携版（内部测试、未签名）/ GitHub Actions 自动打包”三节改为面向外部读者的构建与 CI 说明；不再以“内部”为标题，但保留未签名、未真机验收等事实说明。
- 新增 `docs/assets/` 三张合成数据截图；`test:release-contents` 确认它们不进入发行包。
- 许可已定为 **AGPL-3.0-only**：加入 `LICENSE`（GNU 官方文本）、`NOTICE`（版权、SPDX、第三方归属）、`package.json` 的 `license` 字段；README 说明许可范围、衍生作品与网络服务的源码义务，以及“许可不授予华为接口/商标/内容权利”。
- README 进一步明确 OAuth 应用标识出处：`client_id=101444301` 来自第三方公开帖（吾爱破解下载工具 / `Tontonnow/hwyy`），帖中未说明获取方式；我们的抓取显示它同时是华为音乐在 AppGallery 的应用 ID（`C101444301`），官方回调 scheme 为 `com.huawei.apps.101444301:/oauth2redirect`，因此极可能是官方 App 自身身份。
- 作者选择方案 B：仓库开源（AGPL-3.0）并保留现状；后续按作者要求恢复 **GitHub Release 发布**（未签名学习构建，发布说明写明未签名、非官方、OAuth 身份不属于本项目）。OSS 上的历史二进制已删除并验证 404；不再使用第三方对象存储分发。
- GitHub 仓库转为公开；Gitee 仍私有。

## CI：GitHub Actions 原生 Windows 打包（已跑通）

- 仓库镜像到 GitHub 私有仓库（`talongao/huawei-music-desktop`），CI 工作流 `windows-installer.yml`（原 `windows-portable.yml`）：手动或 `v*` 标签触发，windows-latest 上执行 `npm ci` → 单元测试 → `dist:win` → 安装包静态校验 → SHA256SUMS，发布到 GitHub Release；不上传 OSS。改动后尚未在 Windows runner 上实跑。
- 产物发布：手动运行或 `v*` 标签会创建/更新对应标签的 GitHub Release（exe + SHA256SUMS），不自动传 OSS；标签与 `package.json` 版本不一致会失败。
- 可选 Windows 烟测需要 ffmpeg，runner 不自带，已在步骤内 `choco install ffmpeg`；该步骤失败不阻断任务（此前失败即为缺少 ffmpeg，非应用缺陷）。
- 首次运行验证：run 38936061865 全绿，产物 100,141,218 字节，`SHA256 6d8c829c1613f46da6c01abb04699e7fe8a0001bbfe2de46424d3373dc7b774e`，应用 exe 名称为“华为音乐第三方客户端（学习版）.exe”，图标像素校验通过。
- 为让校验适配 Windows，静态检查改为：解包定位（不解析 7-Zip 清单文本）、兼容展平布局、asar 解包后按文件比对（不再依赖 asar 条目分隔符）。这些修复保留了 Linux 侧原有的 payload 名与 PE 架构断言。
- 原生 Windows 构建与本地 Linux 交叉构建字节不同，两者均通过同一套静态校验；**Windows 启动/播放仍未验收**。

## 第四批完成（去掉默认菜单 / 改名学习版）

- 移除 Electron 默认菜单：Windows/Linux `Menu.setApplicationMenu(null)`，窗口 `autoHideMenuBar`；macOS 仅保留 appMenu/editMenu/windowMenu 最小角色，Cmd+Q 等仍可用。smoke 回归新增断言：应用菜单为 null 且窗口菜单栏不可见。
- 改名为“华为音乐第三方客户端（学习版）”：显示名集中在 `src/shared/app-name.mjs`（窗口标题、侧栏、设置页、托盘 tooltip），`build.productName` 同步改为该名称，exe 显示名与 Linux desktop `Name` 一致；`package.json` 的 `name` 与 `appId` 未改，因此 userData 目录和已存设置/登录数据不迁移、不丢失。
- 回归：140 项单测、smoke（含菜单断言）、UI、业务、965 首、cancel/callback/navigation 均通过；Windows 包静态校验通过（应用 exe 改为动态发现，图标像素校验仍通过）；重命名后 Linux 包含新名称与图标。

## 第三批完成（登录内嵌窗口 / 自绘图标）

- 登录宿主由独立 `BrowserWindow` 改为主窗口内的 `WebContentsView`：远程页依旧无 preload、无 Node、独立临时 partition，权限/下载全拒；顶部保留 48px 取消条（`LOGIN_VIEW_TOP_INSET`），新增 `auth:cancelLogin` 白名单 IPC；窗口 resize 会重排视图，窗口关闭/取消/清理失败仍 fail-closed。
- 回归更新：取消用例改为点应用内“取消登录”，并断言全程 `BrowserWindow.getAllWindows().length === 1`；回调用例同步；live 工具改从 `web-contents-created` 取脱敏导航轨迹、按 URL 解析内嵌页。
- 图标：`scripts/make-icon.mjs` 从 Lucide（ISC）Music 字形生成 `build/icon.png`(512) 与 `build/tray.png`(32)，托盘改用生成的 `src/main/icons.ts`；归属声明写入 `build/icon.LICENSE.txt`。
- 图标证据：Windows 包内 `.icon-ico/icon.ico` 被解析出 16/24/32/48/64/128/256 七档，最大档 PNG 解码后品牌底色覆盖 85.6%、字形 11%（Electron 默认图标不可能满足）；Linux AppImage 内的 `huawei-music-desktop.png` 与 `build/icon.png` SHA-256 逐字节一致，`.desktop` 的 `Icon=` 指向它。
- 回归：140 项单测、smoke、UI、业务、965 首、cancel/callback/navigation、Linux AppImage 启动与重复解压不丢数据均通过。

## 第二轮完成（歌单缓存 / 随机播放 / 历史同步）

- 歌单缓存：`src/main/memory-cache.mjs` + `AuthManager` 进程内 5 分钟缓存；重复读歌单/详情不再请求，显式 `refresh` 回源；写操作与切换账号失效。生产业务测试断言重复读不增加网络请求、刷新只增加一次。
- 随机播放：设置页新增“随机播放（打乱队列顺序）”模式，与工具栏随机按钮同源；随机模式下“上一首”按实际播放顺序回退（`pushPlayHistory`/`popPlayHistory`）。
- 播放历史上报：`recentlyplayed/create` 按公开 H5 形态实现（`src/music.mjs` + `huawei.createRecentPlay`），真实收听达阈值后只报一次，秒数为实际收听；`syncHistory` 可关；`retry:false`、失败静默。**未用真实账号发起过写请求**，服务端效果待验。
- 测试：140 项单测、Electron smoke/UI/业务/965 首回归全部通过；UI 回归断言真实播放只上报一次且不超过整曲时长；业务回归断言上报负载与失败静默。

## 上一轮完成

- `src/main/favorites-catalog.mjs`：50 首分页计数到末页、ID 去重、在途请求共享、刷新/账号变更失效、无进展保护。接口无可靠总数字段，不猜接口或硬编码 960/965。
- `src/renderer/favorites-page.tsx`：总数与已加载数独立显示，底部预取下一批，错误保留内容并暂停自动重试；保留切页数据/滚动位置；播放全部先补齐分页，可取消准备。
- `src/main/writes.mjs`：owned 归属核验、写后读回、幂等/互斥、创建未决意图持久化。JSON 写入按文件串行，账号退出清队列、缓存、历史、未决意图及损坏备份；保留通用设置。
- `test:electron-business`：**不替换业务 IPC**，仅模拟登录页和 HTTP transport，生产 AuthManager/API/IPC 流程覆盖读取、写约束、缓存、400、退出清理；主进程 965 首扫描正好 20 页，随后读末页不重发。
- `test:electron-favorites`：965 首合成库，50→100→失败→重试→150，返回页面位置不变；播放全部取得 965 首，实际 queue.json 也是 965 首，无音频地址。
- `test:electron-ui`：页面、合成音频、写 UI、设置即时同步、最小窗口几何、队列跨进程恢复。
- 登录取消回归修复测试时序：等实际 CAS 页面后再投递错误 state；生产登录逻辑未因该测试更换。

## 自定义全局快捷键 / 无版权曲目显示（2026-10-21 第四轮）

- 全局快捷键：新增 `src/shared/shortcuts.mjs`（纯逻辑：动作/默认键位/加速器校验/冲突消解，参考常见音乐播放器的 Ctrl+Alt+ 组合）+ 主进程 `applyGlobalShortcuts`（globalShortcut，物理媒体键始终注册，用户键随 settings 变更即时重注册，OS 占用冲突静默跳过）+ IPC `settings:update` 后经 hooks 通知重注册，无新增 channel（复用 `player:command`）。命令集扩展为 play-pause/next/previous/volume-up/volume-down/mute/like，renderer 统一分发（音量走 ref 避免闭包旧值；like 收藏当前曲，状态未知时先查后切换）。设置页新增「快捷键」分类：点击录制组合键（必须含 Ctrl/Alt/Win 修饰键，Esc 取消、Backspace 清除禁用）、同键冲突自动从旧动作移除、一键恢复默认。shortcuts 存入 AppSettings 并经 `sanitizeShortcuts` 落盘校验（输入优先、fallback 补位、同键唯一）；`shortcuts.d.mts` 提供类型。新增 6 项快捷键单测。
- 无版权曲目：`trackFrom` 读取响应 `status` 字段（明确非 "1" = 不可用，字段缺失视为可用，避免误杀不带该字段的接口）；列表行 `is-unavailable` 灰显+删除线+播放按钮禁用（Ban 图标）；`play()` 拒绝无版权起点并自动把队列过滤为可播放曲目；全不可播时提示。新增 4 项断言。
- 回归：typecheck、181 项离线单测全部通过；Windows 本机 `dist:win` 重建、重装、启动 4 进程正常。快捷键的真实全局触发（其他应用聚焦时按键）与录制 UI 交互未做自动化验收，以人工使用为准。

## 桌面歌词悬浮窗（2026-10-21 第五轮）

- 新增置顶悬浮桌面歌词：`src/main/desktop-lyrics.ts`（无边框透明 always-on-top 窗口，screen-saver 层级、全工作区可见、不占任务栏；锁定 = `setIgnoreMouseEvents(true, {forward:true})` 鼠标穿透）+ `src/renderer/lyrics.html` / `lyrics-main.ts` / `lyrics.css`（纯 DOM 无 React，深色胶囊背景 + 当前行大字 + 下一行/翻译预览，解锁态显示锁定/关闭按钮，整行 `-webkit-app-region: drag` 拖动，拖动落点防抖 800ms 持久化）。
- 数据流：主窗口 renderer 在歌词行变化时 `ipcRenderer.send(desktop-lyrics:update)`（行索引去重，非每次 timeupdate 都发）→ 主进程 `sanitizeDesktopLyricsUpdate`（文本 500/标题 200 字符钳制，空推送丢弃）→ 转发歌词窗口；锁定状态经 `desktop-lyrics:state` 推送同步。歌词加载条件扩展为「抽屉/沉浸页/桌面歌词任一需要」。位置记忆 `desktopLyrics.position`（整数坐标、±32768 钳制）。
- 安全：歌词窗口独立最小 preload（`src/preload/lyrics.ts`，仅订阅渲染 + 锁定/关闭，无凭据无音乐无设置面）；**sandbox preload 不允许 require 相对路径 chunk**，因此歌词 preload 不共享模块、channel 名字面量内联（与 channels.ts 人工同步）；`ipcMain.on` 监听器全部幂等注册（removeAllListeners 后再 on），防窗口重建叠加。设置页「播放」分类新增桌面歌词开关 + 锁定开关。
- 构建：electron-vite renderer/preload 改多入口（`out/renderer/lyrics.html` + `out/preload/lyrics.cjs`），产物无共享 chunk。
- 回归：typecheck、189 项离线单测（新增 4 项 payload/settings 断言）、`test:electron` smoke、`test:electron-ui` 全部通过——**均为 Windows 本机首跑全绿**（本机补装 ffmpeg 后；宿主 `ELECTRON_RUN_AS_NODE` 需清除）。smoke/ui 的 preload API 键断言加入 `desktopLyrics`。歌词窗口的拖动/锁定穿透/多显示器行为以人工验收为准。

## 下一首播放（2026-10-21 第六轮）

- 曲目行新增「下一首播放」按钮（SkipForward 图标，无版权禁用）。纯逻辑 `planPlayNext`（`src/renderer/player.mjs`）：queue 物理顺序与 order 播放顺序同步更新——新歌插到当前曲后一行；已在队列的歌按 id 匹配移动到该槽（顺序/随机模式都成立）；移动后 cursor 重算仍指向正在播放的曲；连点多次时后点的排在更前（与主流播放器一致）；无播放时排到队首。播放历史清空（队列被用户主动重排，避免「上一首」回到错乱位置）。`App.playNext` 拒绝无版权曲并提示。
- 回归：typecheck、192 项离线单测（新增 7 项 planPlayNext 断言，其中一项抓出并修复 order 槽位移动后插入点未按删除后坐标系重算的真实 bug）、`test:electron`、`test:electron-ui` 通过；Windows 本机重建重装启动正常。按钮交互以人工验收为准。

## 桌面歌词外观设置与锁定按钮修复（2026-10-21 第七轮）

- 修复「锁定按钮点了没反应」真实 bug：`lyrics-main.ts` 里 `setLockedClass(!locked)` 已把模块内 `locked` 改成新值，紧接着 `setLocked(!locked)` 又反转回旧值，本地乐观更新与实际推送互相抵消，主进程始终写回原状态。改为先算 `next` 再统一使用。用 playwright 实测确认：修复后点击可锁定（`click-to-lock WORKED`），锁死后第二次点击超时正是鼠标穿透的预期表现（解锁需回到设置页）。
- 新增桌面歌词外观设置：`fontColor`（#rrggbb，五个预设色 + 取色器，HEX 白名单校验）与 `backgroundOpacity`（0–1 钳制，滑杆）。经 `desktop-lyrics:state` 通道在每次 apply 时推送，歌词窗口以 CSS 变量（`--lyrics-font-color` / `--lyrics-bg-opacity`）实时应用；解锁态背景在用户值上 +0.15 保证控制条可读。旧存储缺字段时由默认值补齐（新增断言）。
- 回归：typecheck、194 项离线单测、`test:electron` smoke、`test:electron-ui` 通过；Windows 本机重建重装启动正常。

## README fork 化（2026-10-22 第八轮）

- 原 `README.md` 以 `git mv` 改名为 `README-Talongao.md`（保留完整原文与 git rename 历史，作为原项目文档）。
- 新建 `README.md`：声明 fork 自 Talongao 的原项目，并注明本 fork 新增与修改内容**由 AI 编程助手（华为云 CodeArts）在本人主导下完成**（本人提需求与验收、AI 实现与回归）；原项目能力与完整文档指向 README-Talongao.md；按真实改动列出本 fork 六项差异（品牌与图标、无版权显示与队列过滤、自定义全局快捷键、桌面歌词悬浮窗及外观设置、下一首播放、Windows NSIS 本机验证），并保留非官方/AGPL-3.0/不绕过付费 DRM 的边界声明。纯文档变更，无代码改动，无新增测试。

## 断流自动重试改为断点续播（2026-10-22 第九轮）

- 用户报告「莫名其妙的重新播放了」。代码定位根因：audio `error`（华为 CDN 断流/网络波动）→ `failed` handler 自动重试 `playAt(cursor, 1)` 时**未携带断点进度**（`pendingSeek` 为 null）→ `playAt` 将进度归零 → 当前曲从头播放；用户无任何操作，只有一条一闪而过的消息，观感即「莫名其妙重新播放」。
- 修复：`track-reconcile.mjs` 新增纯函数 `mediaFailureResumeAt(currentTime)`（有限且 >1s 才返回断点，否则 null；新增单测）；`failed` 重试改为 `playAt(cursor, retry, { resumeAt })`；`playAt` 开头统一 `pendingSeek.current = options.resumeAt ?? null`——顺带消除隐患：重试失败后残留的 `pendingSeek` 不再泄漏到用户手动点的下一首歌（`playAt` 成为唯一写点）。
- 回归：typecheck、195 项离线单测、`test:electron` smoke 通过；Windows 本机重建重装启动正常。真实华为 CDN 下的断流续播效果需实际使用观察（自动化测试用合成音频无法复现 CDN 断流）。

## 测试边界

已运行：`npm ci`、typecheck/build、134 项单测、`test:electron`、`test:electron-ui`、`test:electron-business`、`test:electron-favorites`、`test:login-callback`、`test:login-cancel`、`test:login-navigation`、发行内容检查。公开登录页回归没有扫码或令牌交换。

`test:safe-storage-restart` 在当前 Linux 明确失败于 basic_text/backend 检查。**不通过 mock 加密器、明文后端或其它平台声明来代替它。**

截图位于被忽略的 `release/qa/`，其中 `linux-favorites-965-synthetic.png` 与 Smoke MP3/FLAC 都是离线测试内容，绝不是用户真实账号数据。当前 AppImage 是内部测试，不代表 M1 或三端验收完成。

本轮未读取/导入 `.local/` 私人会话、未执行任何真实账号写操作，因此没有新增真实对象需要清理。测试 profile 与合成资源由脚本 finally 清除。源码后按用户授权提交至 Gitee 私有仓库；安装包/凭据/日志未上传，未改系统代理。

## 运行与剩余参与点

- Linux 桌面：`npm ci && npm start`；headless 自动化：`npm run test:electron-favorites` 等命令自动使用 Xvfb。
- Linux 构建：`npm run dist:linux`；产物 `release/linux-x64/`。`test:packaged` 可检查 unpacked 或从 AppImage 提取的实际二进制。
- 真实账号完整收藏：新增 `npm run test:login-live -- --login --qr --full-library`，同一次本人授权核验总数、完整分页和滚动加载，只输出统计；默认不会运行。真实 MP3/FLAC 播放仍另验，不以该脚本冒充。
- 最新 AppImage：`release/linux-x64/huawei-music-desktop-0.0.1-linux-x86_64-internal.AppImage`；`release/linux-x64/SHA256SUMS` 已生成。`npm run test:packaged -- <AppImage路径>` 已通过，未上传。
- ~~Windows portable~~（已废弃）：2026-10-18 起不再产出单文件免安装版，改为 NSIS 安装包；历史验证记录保留但不再适用当前构建目标。
- Windows 本机安装（2026-10-21，Windows 11 x64）：`npm run dist:win` 原生构建 NSIS（`release/win-x64/huawei-music-desktop-0.0.1-win-x64-setup-internal.exe`，未签名）→ `/S` 静默安装 per-user（`%LOCALAPPDATA%\Programs\huawei-music-desktop\`，注册表卸载项 + 开始菜单快捷方式就位，无桌面快捷方式，符合配置）→ 安装版启动 4 进程、主窗口标题正确。安装版为全新 userData（与开发版不共享会话，需重新扫码）。**安装版登录/播放/托盘/卸载保留 userData 未逐一验证**；CI runner 实跑仍未做。
- ~~`npm run test:portable-data`~~（已随 portable 目标移除）：该测试验证的是「解压到临时目录后用户数据不丢」，安装包场景改为覆盖安装保留 userData，待 Windows 真机验收。
- 视觉选择：`design-previews/2026-10-15-desktop/index.html` 的 A/B/C/D，未选前保持当前基础样式。
- Linux 密钥服务、真实听播、托盘/物理媒体键/睡眠仍需环境证据；Windows/macOS 原生测试延后，不阻塞共享逻辑。

历史流水及旧沙箱阻塞记录见 [IMPLEMENTATION_HISTORY.md](IMPLEMENTATION_HISTORY.md)，只作历史，不是当前环境结论。登录修复证据见 [LOGIN_CALLBACK_FIX.md](LOGIN_CALLBACK_FIX.md)。
