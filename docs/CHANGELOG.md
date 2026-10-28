# 变更记录

每条记录对照上一个提交，列出文件级与行为级变化。进度与验收视角见 [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)。

## 2026-10-28 — `4fac4c9`（对比 `71d9213`）

主题：按曲音质档位切换、搜索页播放全部、会话过期感知与 refresh_token 留存。
规模：25 个文件，+494 / −73 行（其中测试 +145 行）。

### 新增文件

| 文件 | 内容 |
|---|---|
| `src/shared/qualities.mjs` + `.d.mts` | 音质档位纯逻辑：`QUALITY_ORDER` / `QUALITY_CODES` / `QUALITY_LABELS`、qualityType(1/2/3/7) 与档位互转、`fallbackQuality` 回退 |
| `src/shared/session-expiry.mjs` + `.d.mts` | 14 位 `expireTime`（yyyyMMddHHmmss）解析与过期判定；UTC/本地双解释取较晚者，晚判不误报；不可能日期经重建 round-trip 校验判 null |
| `test/qualities.test.mjs` | 档位互转与回退 4 项断言 |
| `test/session-expiry.test.mjs` | 双解释上界、过期判定、非法输入 3 项断言（时区无关） |

### 音质档位（用户可感知行为变化）

- 列表/详情解析 `contentExInfo.completeFileInfos`（`src/main/library.mjs` +35），`Track.qualities` 只暴露 标准(1)/HQ(2)/无损(3) 三档；**超清(7) 撤下**——超钻会员实测被服务端以 resultCode 142411 拒绝，属设备链路限制，不归因会员等级。
- 播放坞新增档位弹出菜单（`src/renderer/components.tsx` +42），当前档打勾；切换**立即换流并保留播放进度**（`src/renderer/App.tsx` `changeQuality`）。
- 请求档不可用时自动回退：先向低找最高，再向高找最低（只有更高档的歌也能播，并提示实际档位）。
- 设置页新增默认音质下拉（`pages.tsx`、`settings.mjs` `QUALITIES`/`sanitizeQualities`）；队列持久化保留每曲档位（`sanitizeTrack` 条件附加，无值不加键）。
- 播放实际档确认改为以响应 `playQuality` 数字为准（`track-quality.mjs` 重写 99%）；旧 `confirmedPlaybackQuality` 的 `type` 字段 MIME 交叉假设被真实样本推翻（`type:"1"` 是枚举）。
- `src/music.mjs` / `ipc.ts` / `auth-manager.ts` / `huawei.ts`：resolvePlayback 链路改传档位码，IPC 白名单与签名同步（`Playback.actualQuality: Quality | 'unknown'`）。

### 搜索页播放全部

- 有更多分页时按钮显示「播放已加载 N 首」，只播已加载且无版权过滤后的曲目，不宣称播全量结果（`pages.tsx`）。

### 会话过期感知与 refresh_token 留存（无自动续期）

- `openLogin`（`huawei.ts`）保留 offline 授权响应中的 `refresh_token`，持久化到 `session.enc` 的 `oauth.refreshToken`（`storage.ts` 类型、`session-store.cjs` 载入时归一为可信形状，其余形状丢弃）；logout 一并清除。**仅留存，登录流程不使用**——公开客户端 refresh grant 已于 2026-10-14 实测被拒（1101/20171，见 [token-lifetimes-and-renewal.md](token-lifetimes-and-renewal.md)），7 天后用真实凭据复测。
- 音乐请求被服务端拒绝（ProviderError）且字面已过期时，错误文案统一为「音乐登录已过期，请重新扫码登录。」（`code: session-expired`，`auth-manager.ts` +39 中含 `#expiredFailure`）；仅网络错误或未过期时保持原结构化错误。
- 收藏与歌单/专辑在此场景回退本地缓存（与既有网络失败回退同机制）。
- 侧栏状态点亮橙显示「音乐登录已过期」（`App.tsx`、`styles.css` `.status-dot.expired`）；右上角「重新登录」按钮原有。

### 测试

| 文件 | 变化 |
|---|---|
| `test/library.test.mjs` +38 | completeFileInfos 两种形态解析、三档暴露（不含 ultra） |
| `test/settings.test.mjs` +31 | 默认音质档位、队列 qualities 保留 |
| `test/playback-quality.test.mjs` 重写 83% | 以 playQuality 数字为准的确认逻辑 |
| `test/session-store.test.mjs` +21 | oauth 往返与归一（垃圾字段丢弃、坏形状删键） |
| `test/qualities.test.mjs` / `test/session-expiry.test.mjs` | 新文件 |

离线单测 201 → **205** 项；`test:electron` / `test:electron-ui` / `test:electron-business` 全部通过。

### 实测结论（本轮新增的契约事实）

- qualityType 7 在超钻账号 + HTTP 200 下返回 resultCode `142411`：超高清 2.0 需要 HarmonyOS NEXT 设备 + 华为耳机 L2HC 全链路，且该档在 completeFileInfos 无 fileSize（设备端动态处理流），桌面端不暴露。
- `auditionTime` 在会员完整播放时同样出现，继续不作为试听判据。
