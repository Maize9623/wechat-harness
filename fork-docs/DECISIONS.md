# DeepSeek Harness WeChat Desktop — 基线决策

记录时间：2026-09-18（Asia/Shanghai）
任务：独立 Desktop Preview 微信式双轨版
权威范围：`fork-docs/MIGRATION_SPEC.md`（2026-09-16 规格）+ 开工时重新核对的官方现状

## 1. 固定上游

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/deepseek-ai/deepseek-harness |
| 选用规则 | 最新可构建官方 Desktop Release/tag；无独立 Desktop installer 时用该 tag 对应 SHA |
| 最新 tag | `dsh-v0.1.6-alpha.2` |
| 该 tag SHA | `ddefc45fbc7f8e46dd73185e68295696d1297887` |
| 开工时 master HEAD | 同一 SHA |
| 根 / Desktop / Host 版本 | `0.1.6-alpha.2` |
| 开发分支 | `desktop-wechat-port` |
| 项目目录 | `/Users/gene/Desktop/deepseek harness desktop` |
| 开发 Node | v25.9.0（满足 `^22.19.0 \|\| >=24.0.0`） |
| packageManager | pnpm@11.7.0 |
| Electron | ^44.0.0 |
| Host 启动 | 打包：Electron `ELECTRON_RUN_AS_NODE=1`；开发：当前 Node 调用 `pnpm run dev:desktop` |
| 官方 Host 默认端口 | `19387`（`--no-open --port 19387`） |
| 官方公开安装包 | 该 Release 无 assets；本机只能走源码 `dev:desktop` / 后续自建 artifact |
| GitHub combined status | 公开 status API 为空；采用官方已发布 tag，不因空 status 回退 |

首个可运行版本完成前固定该 SHA，不追 master。

## 2. 相对 2026-09-16 研究快照的架构更正

规格第 4 节是研究快照。开工时官方 Desktop 已明确变成「完整 dsh Web 应用外的 Electron 薄壳」：

- Renderer 从 `dsh-app://app/` 加载打包 Web 入口，不是独立第二套桌面后端。
- Host 通过共享 profile runner 启动完整 Web 组合，默认监听 `19387`，与 Web 的 `3080` 分开。
- 2026-09-10 官方决策已部分取代「无端口分帧管道、不监听 HTTP」的旧 Desktop 方案。
- 官方 `dev:desktop` 仍把开发状态写到 `apps/desktop/.desktop-build/development/{home,project,electron-user-data}`。
- 官方默认调试口仍是 Renderer 9222、Main 9229、Host 9230。
- 官方打包应用 ID 仍是 `com.deepseek.dsh`；本 fork 不得复用。

本项目跟随 **当前官方薄壳架构**，不把过期的「Desktop 绝不能有 localhost Host」写成实现约束。
仍然禁止：连接旧 3080/3091、占用 3080/3091/5226、把 Web 套壳旧系统冒充完成。

## 3. 私有身份（开发期）

| 项 | 值 |
|---|---|
| productName | DeepSeek Harness WeChat Preview |
| app ID | `com.ainfinity.dsh.wechat.preview` |
| 群聊 sidecar 默认端口 | `3191`（可配置；启动前检测占用） |
| 官方更新 | 私有预览关闭官方 feed / 自动检查 |
| 旧系统 | 冻结，本任务不修改、不重启、不停止 |

打包期再把 app ID / userData / app-owned `DSH_HOME` 写进主进程；`dev:desktop` 先用官方开发隔离目录证明原版能跑。

## 4. 旧系统只读基线（本任务未改动）

见 `OLD_SYSTEM_BASELINE.md`。开工与建分支后复测：`127.0.0.1:3080` 与 `127.0.0.1:3091` 均为 HTTP 200。
