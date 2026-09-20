# 旧 3080/3091 只读基线

采集时间：2026-09-18 14:36–14:38（Asia/Shanghai）
方式：只读进程/端口/HTTP/Git 查询。本任务没有安装依赖、改文件、重启或停止旧系统。

## 进程与端口

| 端口 | 绑定 | PID | 作用 | HTTP |
|---|---|---|---|---|
| 3080 | 127.0.0.1 | node 42115 | 现有 Harness Web + 微信式 UI | 200 |
| 3091 | *（全网卡） | node 42115（同进程） | 现有局域网群聊 | 200 |
| 5226 | 127.0.0.1 | node 42114 | Aico 控制台 Harness 启动入口 | LISTEN |

同一 node 进程同时提供 3080 与 3091。

## 路径与版本

| 项 | 值 |
|---|---|
| 启动器 | `/Users/gene/Documents/Codex/2026-06-08/launcher/deepseek-harness-entry` |
| 运行包 | `@deepseek-ai/dsh@0.1.1-rc.2` |
| 旧官方 checkout | `/Users/gene/Documents/Codex/2026-08-14/ya/deepseek-harness` @ `b150a551` / tag `dsh-v0.1.1-rc.2` |
| 微信插件工作树 | `/Users/gene/Documents/Codex/2026-08-14/ya/deepseek-harness-diy` |
| 插件 Git HEAD | `67a1aef9fc555f7dc8aea3aec8f22c5d168f637c` |
| 工作树脏文件 | 56（未提交内容是现有功能的一部分；不得在旧目录整理） |
| Profile | `~/.dsh/profiles/web` |
| 插件加载 | web profile 通过 `link:` 加载 `dsh-diy-lab` |

未读取、未复制凭据或 Key。

## 可复用源码清单（只读）

插件包名 `dsh-diy-lab@0.1.0`。后续导入只复制源码，不 symlink。

```text
src/client/*          微信式 Renderer
src/collab/*          3091 协作服务与测试
src/file-attachments.js
src/file-server.js
src/index.js
src/scheduler.js
src/services.js
```

排除：`.git`、`node_modules`、`lib`、`.collab-data`、`.schedule-data`、`.file-data`、`backups`、旧 `cordis.patch.yml` 实例、运行状态、Key。
