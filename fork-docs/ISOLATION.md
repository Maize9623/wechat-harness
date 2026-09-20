# 六层隔离

本 fork 与现有 3080/3091 必须同时可运行，且无运行时耦合。

## Git / 源码

- 新目录独立 clone，不复用 rc.2 checkout，也不把 2026-09-16 研究副本当工作树。
- 开发分支 `desktop-wechat-port`，固定 `ddefc45fbc7f8e46dd73185e68295696d1297887`。
- 从旧插件复制源码，禁止 `link:` / `file:` / symlink 指向旧目录。
- 产物与 lockfile 不得含旧绝对路径。

## DSH_HOME

| 形态 | 期望 |
|---|---|
| 官方 `dev:desktop` | `apps/desktop/.desktop-build/development/home` |
| 私有打包 | 主进程计算 app-owned home，传给 Host / 包管理器 / sidecar |
| 禁止 | `~/.dsh`、`~/.dsh/profiles/web` |

解析到旧 home 必须 fail closed。

## Electron userData

| 形态 | 期望 |
|---|---|
| 官方 `dev:desktop` | `apps/desktop/.desktop-build/development/electron-user-data` |
| 私有打包 | 取得单实例锁之前 `app.setPath('userData', …)` |
| 禁止 | Chrome 数据、官方 `com.deepseek.dsh` userData |

## Workspace / 凭据

- 空白启动；用户在新 Desktop 里另选 Workspace、另录 Key。
- 不打开旧 Harness 源码、旧用户项目或本仓库作为默认工作区。
- 不从旧 Profile / `.env` / 旧 Keychain / 调用环境继承 Provider 凭据。
- Key 只进 Host credential storage；Renderer / LAN / Git / 日志不得持久化。

## 端口

| 使用者 | 端口 | 说明 |
|---|---|---|
| 旧 Web | 3080 | 冻结，禁止占用或代理 |
| 旧群聊 | 3091 | 冻结 |
| 旧启动器 | 5226 | 冻结 |
| 官方 Desktop Host | 19387 | 新系统内部 Web Host，不是旧 3080 |
| 官方 dev 调试 | 9222 / 9229 / 9230 | 必须仅 loopback |
| 新群聊 sidecar | 3191 | 默认关闭局域网；显式打开后才绑 LAN |

打包形态不得再起一套 `dsh web` 冒充 Desktop。官方 Desktop 自己的 `19387` Host 是薄壳架构的一部分，可以保留，但必须与旧 3080 分离。

## 生命周期

- 本任务不 start/stop/restart 旧进程。
- 新 Desktop 退出后释放自己的 19387 / 3191 / 调试口。
- 旧 3080/3091/5226 在每个里程碑复测仍为可访问。
