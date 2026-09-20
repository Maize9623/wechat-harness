# 能力矩阵初稿

分级依据：旧 `dsh-diy-lab` 工作树（2026-09-18 只读）+ 官方 `0.1.6-alpha.2` Desktop 现状。
证据列在导入与联调后回填。未经验证不得标「完成」。

图例：`P0` 首个可运行微信 Desktop 必须有；`P1` 完整对等；`P2` 可延后；`官方已有` 优先复用 Desktop/Web 原生能力。

| ID | 能力 | 旧系统来源 | 优先级 | 官方 0.1.6-alpha.2 现状 | 移植策略 | 状态 |
|---|---|---|---|---|---|---|
| D0 | 官方原版 Desktop 启动 | — | P0 | `pnpm run dev:desktop`；`dsh-app://`；Host `:19387` | 先原样验收 | 未跑 |
| D1 | 独立 home / userData | 开发目录隔离 | P0 | dev 写入 `.desktop-build/development/*` | 先用官方 dev 隔离；打包再改 app-owned | 未跑 |
| D2 | 不连接旧 3080/3091 | 双轨规格 | P0 | Desktop 默认 19387 | 禁 3080/3091/5226 | 未跑 |
| U1 | 微信式三栏壳 | `WechatShell.tsx` | P0 | Desktop 现为官方 Web UI | 内置 bundle overlay | 未开始 |
| U2 | 会话列表 / 新建 / 切换 | `LiveOverlay` + Host session API | P0 | 多实例 Session API 已变 | 按新 slot/API 重接，不沿用 rc.2 client-runtime | 未开始 |
| U3 | 消息流、思考、工具状态 | `ConversationPane` | P0 | Web trajectory 已增强 | 接当前 assistant block / turn+step | 未开始 |
| U4 | 发送 / 停止 / 追问 | 原生 session | P0 | 官方仍有 pending question | 接 Desktop 认证 HTTP / 现有 client API | 未开始 |
| U5 | 模型 / 权限 / Workspace | 输入区图标 | P0 | 官方设置页仍在 | 优先复用官方页面，微信壳只做入口 | 未开始 |
| U6 | 图片与文件附件 | `fileAttachments` + 3091 附件 | P0 | trajectory 已统一附件 | 走官方附件 API | 未开始 |
| U7 | 右侧预览 / 沉浸 | `ConversationSidePanel` | P1 | 官方侧栏已有 URL / Office / diff | 能复用官方侧栏则复用 | 未开始 |
| U8 | 微信/原生 UI 切换 | `uiMode.ts` | P1 | 无 | 内置 bundle 配置，不靠卸载 | 未开始 |
| U9 | 头像 / 资料 / 人格 | `Avatar` `persona` | P1 | 无对等 | 新 userData，不读旧 localStorage | 未开始 |
| U10 | 用量看板 | `UsageDashboard` | P2 | 官方有上下文用量 | 可后置 | 未开始 |
| H1 | 文件 / 服务 / 调度 Host | `src/services.js` 等 | P1 | Desktop 已是完整 Web Host | 能走官方 API 则删除 apiProxy | 未开始 |
| C1 | 独立群聊 sidecar | `src/collab` | P0（空白群）/ P1（全模式） | 官方无 LAN 群聊 | 新端口 3191，新存储 | 未开始 |
| C2 | 邀请 / 房间 / 成员 | collab server | P1 | 无 | 复制逻辑，清路径与 3091 | 未开始 |
| C3 | 群实时桥 | mux / history | P1 | Desktop 用认证 WebSocket | 接新 Host，不接旧 mux | 未开始 |
| P0-risk | Session 多实例 + slot 变更 | 旧单实例 overlay | P0 | Release 明确 breaking | 先对照官方 client catalog 再写适配层 | 阻塞调研 |
| P0-risk | 插件运行时解析 / 可卸载 | 旧 link 安装 | P0 | 0.1.6-alpha.2 起 runtime resolution | 微信壳做成 built-in bundle，不可被普通卸载 | 阻塞调研 |

## 明确不做（本轮）

- 迁移旧会话、Key、Workspace、群数据、浏览器状态
- 与旧 3091 互通
- 公共 npm 发布
- 复用官方更新通道
- 把 `dev:desktop` 成功写成正式签名安装包验收
