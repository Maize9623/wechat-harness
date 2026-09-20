# WeChat Harness

私有仓库，暂不公开。

WeChat Harness 是一套本机桌面 Agent 工作台：在微信式会话里指挥 DeepSeek，由官方 DeepSeek Harness Desktop Host 执行工具、读写工作区、调度任务。需要多人协作时，再开一个同壳的群聊窗口。

本仓库包含上游 DeepSeek Harness `dsh-v0.1.6-alpha.2` 的完整源码，以及 WeChat 壳、Desktop 品牌和群聊 sidecar。

## 这是什么 / 不是什么

| 是 | 不是 |
|---|---|
| 本机 Electron 应用 **WeChat Harness**（`ai.ainfinity.wechat-harness`） | 腾讯官方微信 |
| 官方 Desktop Host（本机 `19387`）外面的微信式壳 | 浏览器里的 Aico、`dsh web`、旧 `3080` |
| 单机窗口 + 群聊第二窗（`3191`） | 旧 `3091` 房间的升级或数据迁移 |
| 空白项目：Key、工作区、会话、群数据各自独立 | 从旧系统导入历史 |

评审手册见 [fork-docs/PRODUCT_MANUAL.md](fork-docs/PRODUCT_MANUAL.md)。隔离承诺见 [fork-docs/ISOLATION.md](fork-docs/ISOLATION.md)。

## 仓库身份

| 项 | 值 |
|---|---|
| 产品名 | WeChat Harness |
| 群聊窗口 | WeChat Harness 群聊 |
| Bundle ID | `ai.ainfinity.wechat-harness` |
| 开发包 | `~/Applications/WeChat Harness.app` |
| 上游 | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) tag `dsh-v0.1.6-alpha.2`（`ddefc45`） |
| 开发分支 | `desktop-wechat-port` |
| 本仓库默认分支 | `desktop-wechat-port` |

本地 `origin` 仍指向官方上游。本私有仓库使用 remote 名 `wechat`，避免覆盖官方地址。

## 源码位置

```text
apps/desktop/                 Electron 薄壳、品牌、群聊第二窗
packages/private/wechat-ui/   微信式客户端壳
packages/private/wechat-host/ Host 路由与 3191 群聊 sidecar
packages/private/wechat-app/  官方 profile 上的私有 bundle
fork-docs/                    评审手册与隔离说明
```

其余 `packages/`、`vendor/`、`apps/`、`native/` 是上游 Harness，请先读 [docs/architecture.md](docs/architecture.md) 再改。

## 环境

- macOS（当前开发主路径）
- Node.js `^22.19.0 || >=24.0.0`
- pnpm `11.7.0`（见根目录 `packageManager`）
- 本机可用的 `DEEPSEEK_API_KEY`（写入根目录 `.env`，不要提交）

```sh
git clone https://github.com/Maize9623/wechat-harness.git
cd wechat-harness
pnpm install
```

`.env`、`node_modules/`、`lib/`、`.desktop-build/` 已被忽略，不要把 Key 或构建产物推进仓库。

## 启动

第一次或改过 Host / 客户端 / 群聊壳之后：

```sh
pnpm run dev:desktop
```

已有构建产物、只想重新打开窗口：

```sh
pnpm run start:desktop
```

成功时：

1. `~/Applications/WeChat Harness.app` 启动，主窗口进入微信式三栏。
2. 本机 `19387` 对无凭证请求返回 401。
3. 本机 `3191` 提供群聊页。

第一次使用：打开通用设置写入 DeepSeek API Key，再添加一个空工作区，然后建会话发消息。不要把本仓库或旧 Harness 工程当作默认工作区。

群聊版在通用设置里「启动群聊版」。主窗口保持打开；群聊 AI 仍走 `19387`，关掉主窗口等于关掉 Host。

## Computer Use

macOS 需要在 **系统设置 → 隐私与安全性** 里给 `WeChat Harness.app` 打开：

- 辅助功能
- 屏幕录制
- 输入监控

改完权限后重启应用。工具只在会话真正调用电脑操作时才会动本机。不要固定 Dock，也不要退出系统微信。

## 端口与隔离

| 端口 | 用途 |
|---|---|
| `19387` | 本产品 Desktop Host |
| `3191` | 本产品群聊 sidecar |
| `3080` / `3091` / `5226` | 旧系统，禁止占用或代理 |

旧 3080 / 3091 可以同时开着。本产品不读取它们的会话、Key、房间或工作区。

## 文档

| 文件 | 用途 |
|---|---|
| [fork-docs/PRODUCT_MANUAL.md](fork-docs/PRODUCT_MANUAL.md) | 产品手册、演示脚本、故障表 |
| [fork-docs/ISOLATION.md](fork-docs/ISOLATION.md) | 与旧系统的隔离 |
| [fork-docs/DECISIONS.md](fork-docs/DECISIONS.md) | 上游 tag 与应用身份 |
| [docs/architecture.md](docs/architecture.md) | 上游 Harness 架构 |
| [SAFETY.md](SAFETY.md) | 运行前安全说明 |
| [AGENTS.md](AGENTS.md) | 仓库约定（改 `packages/` 前必读） |

官方上游文档站点：<https://deepseek-harness.github.io/deepseek-harness/>

## 许可证

上游 DeepSeek Harness 为 [MIT](LICENSE)。第三方依赖见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

本仓库为私有预览，未授权前不要公开、不要发布到 npm，也不要替换官方 DeepSeek Desktop 更新通道。
