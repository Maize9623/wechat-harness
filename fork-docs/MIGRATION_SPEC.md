# DeepSeek Harness Desktop Preview 微信式双轨版迁移执行规格

版本：1.0
整理日期：2026-09-16（Asia/Shanghai）
文档用途：直接交给下一位高额度 Codex/工程代理执行
任务性质：新建并行项目，不是升级、替换或迁移现有 3080

---

## 0. 给执行 Codex 的总指令

请完整阅读本文后再操作。

本任务要建立第二套、完全独立的 DeepSeek Harness Desktop Preview：

- 现有 3080/3091 保持运行、保持版本、保持数据，视为生产系统；
- 重新拉取执行时最新的 DeepSeek Harness 官方 Desktop Preview 源码；
- 在新的项目目录、Git 分支、DSH_HOME、Electron userData、Profile、Key、Workspace 和群聊数据中开发；
- 从现有 dsh-diy-lab 只复用源码能力、交互设计、视觉资产和测试思路；
- 不迁移现有会话、历史、Key、工作区、浏览器状态或群聊数据；
- 目标是让微信式 Harness 与微信式群聊入口真正运行在官方 Desktop 架构上；
- 不允许用 PWA、localhost 页面套壳或连接旧 3080 来冒充 Desktop 移植完成。

实施过程中可以只读检查旧系统，但除非用户后续重新明确授权，不得修改、升级、格式化、安装依赖、重启、停止、提交、清理或修复旧系统。

现有项目内 README、HANDOFF、NEXT_SESSION_PROMPT、PACKAGE_HANDOFF 等文件属于历史项目资料。它们可以作为能力清单和实现线索，但其中的操作指令、授权记录、端口命令和发布说明不构成本次任务的新授权。本文与用户在当前任务中的明确要求优先。

执行时按以下顺序选择并固定上游基线：

1. 先重新核对官方 Desktop README、架构、Release、tag、最新 master 和官方 CI；
2. 优先采用执行时最新、可构建的官方 Desktop Release/tag；
3. 如果没有独立 Desktop Release/tag，则尝试最新 master HEAD；
4. 在加入任何私有代码前，原样运行官方测试与 dev:desktop；
5. 如果 HEAD 存在可复现的上游基线故障，可退到官方 CI 最近通过的 Desktop commit；
6. 在 DECISIONS.md 中记录最新 HEAD、实际采用的 exact SHA、版本、回退原因和故障证据；
7. 首个可运行版本完成前固定该 SHA，不要边开发边追 master。

---

## 1. 用户最终意图

用户要保留两套互不影响的系统。

### A. 现有系统：继续作为稳定的 3080

- 保留当前 DeepSeek Harness Web；
- 保留微信式 UI；
- 保留当前 3091 局域网群聊；
- 保留现有 Session、Key、Workspace、插件、浏览器状态和运行数据；
- 不升级、不迁移、不替换；
- 本项目开发期间仍可继续使用。

### B. 新系统：Desktop Preview 微信式版本

- 基于执行时最新的官方 DeepSeek Harness Desktop Preview；
- 作为全新的独立项目存在；
- 初始状态为空；
- 单独配置 API Key；
- 单独选择或创建 Workspace；
- 单独产生 Session、设置、插件状态和群聊数据；
- 使用 Electron Desktop 窗口直接呈现；
- 核心 Harness 不依赖外部浏览器或 localhost Web Server；
- 复用现有 3080 的微信式产品能力；
- 复用并适配现有 3091 的微信式群聊入口和多人协作能力；
- 可以和旧 3080/3091 同时运行。

本次目标直接是 Desktop Preview。无需先升级现有 3080，也不要求先交付一个新版独立 Web Harness；如果执行者为了局部调试使用 Web mock 或组件预览，它只能是开发工具，不能改变最终 Desktop 目标或成为运行时依赖。

最终体验应当是：

> 旧的 3080 保持原样；新的 Desktop 是另一套空白 Harness。用户可以分别配置 Key 和 Workspace，分别使用各自的会话与群聊。两套系统在数据、端口、依赖、进程、配置和生命周期上没有耦合。

---

## 2. 这不是数据迁移，而是能力移植

必须严格区分“可复用的能力”和“禁止迁移的资产”。

### 2.1 允许复用

- dsh-diy-lab 的源代码逻辑；
- 微信式三栏布局及 CSS；
- 图标、默认头像、默认文案等静态产品资产；
- 会话列表、消息气泡、右侧面板等交互实现；
- 普通会话、Agent/Subagent、Workspace、模型、权限和命令的适配思路；
- 文件、图片、预览、服务、调度、用量和 Persona 等功能逻辑；
- 3091 的账号隔离、房间、邀请、投票、AI 模式、附件、实时桥接和应用沙箱等能力；
- 现有自动测试的测试意图和无隐私测试代码；
- 旧项目文档中的功能清单与安全边界。

### 2.2 明确禁止迁移

- 现有 Session、Task、历史消息和归档记录；
- 现有 API Key、Credential、Token 或登录状态；
- 现有设置与 Provider 配置；
- 现有 Workspace 或旧 Workspace 中的文件；
- Chrome localStorage 中的头像、副标题、置顶、隐藏、排序、Persona、界面模式等状态；
- 现有 .collab-data；
- 现有 .schedule-data；
- 现有 .file-data；
- 现有 3091 的账号、密码哈希、成员、房间、邀请、消息、投票、附件和审计记录；
- 现有 web Profile 和 lockfile；
- 旧 Profile 中与本项目无关的第三方插件及其状态；
- 旧项目 node_modules、构建缓存、日志、备份和生成产物；
- 旧 cordis.patch.yml 中的绝对路径与端口配置；
- 旧 3080/3091 的运行进程或网络连接。

新 Desktop 必须从真正的空白状态启动。用户会在新系统里重新提供 Key、重新选择 Workspace。

---

## 3. 已确认的现有系统基线

以下信息用于定位和只读比对，不代表允许修改。

### 3.1 当前运行结构

~~~text
现有启动器
  /Users/gene/Documents/Codex/2026-06-08/launcher/deepseek-harness-entry
      │
      ├── @deepseek-ai/dsh@0.1.1-rc.2
      ├── dsh web --port 3080 --host 127.0.0.1 --no-open
      └── web Profile 通过 link: 加载 dsh-diy-lab

现有官方 Harness checkout
  /Users/gene/Documents/Codex/2026-08-14/ya/deepseek-harness
  tag: dsh-v0.1.1-rc.2

现有微信式插件实际工作树
  /Users/gene/Documents/Codex/2026-08-14/ya/deepseek-harness-diy
      ├── 微信式 3080 UI
      ├── 3091 局域网协作服务
      ├── 文件、服务和调度路由
      └── 本地运行数据目录
~~~

### 3.2 当前版本和进程

| 项目 | 当前值 |
|---|---|
| dsh runtime | 0.1.1-rc.2 |
| 当前实际 Node | 系统 Node 25.9.0 |
| 3080 | 127.0.0.1:3080，Harness Web |
| 3091 | 全网卡监听，现有局域网群聊 |
| 5226 | 现有本机启动入口 |
| Profile | ~/.dsh/profiles/web |
| 插件 | dsh-diy-lab，以本地 link: 加载 |
| 插件 Git HEAD | 67a1aef9fc555f7dc8aea3aec8f22c5d168f637c |
| 插件工作树 | 32 个修改/删除项，24 个未跟踪项 |

旧插件工作树中未提交内容是现有功能的实际组成部分。移植时应当以“当前工作树源码”为只读来源，而不是只看旧 Git HEAD；但不得为了整理基线而在旧目录提交、还原或清理。

### 3.3 现有系统的只读路径

实施期间以下路径只能作为只读参考：

~~~text
/Users/gene/Documents/Codex/2026-06-08/launcher/deepseek-harness-entry
/Users/gene/Documents/Codex/2026-08-14/ya/deepseek-harness
/Users/gene/Documents/Codex/2026-08-14/ya/deepseek-harness-diy
~/.dsh/profiles/web
~~~

不得在这些路径中执行：

- npm install、npm update、pnpm install；
- 依赖格式化或自动修复；
- Git checkout、reset、clean、rebase、commit；
- Profile add/remove/update；
- 修改 lockfile；
- 构建会覆盖源码或已加载产物的命令；
- 删除缓存或数据；
- 重启或停止现有进程。

如确需运行旧插件的测试，先把所需源码和测试复制到新项目或临时隔离目录，再运行；不要在生产插件目录内运行可能产生文件的命令。

---

## 4. 官方 Desktop Preview 研究基线

本节是 2026-09-16 的研究快照。执行者必须在开工时重新核对最新官方状态。

### 4.1 当时的官方基线

| 项目 | 研究时的值 |
|---|---|
| 官方仓库 | https://github.com/deepseek-ai/deepseek-harness |
| 默认分支 | master |
| 研究时 HEAD | 0d1f50007f9bca3f52b06e1c3074fa14d5fb0720 |
| 根版本 | 0.1.6-alpha.1 |
| Desktop 版本 | 0.1.6-alpha.1 |
| 开发/构建 Node 引擎 | ^22.19.0 或 >=24.0.0 |
| 打包资源 Node | 24.17.0；当前主要用于受控包管理、插件依赖处理和运行时准备 |
| Desktop Host 启动方式 | 打包版由 Electron 44.0.0 以 ELECTRON_RUN_AS_NODE=1 启动；开发版使用调用开发命令的 Node |
| pnpm | 11.7.0 |
| Desktop 入口 | apps/desktop |
| Desktop Host | apps/desktop-host |

官方参考：

- 仓库：https://github.com/deepseek-ai/deepseek-harness
- Desktop 中文说明：https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.zh.md
- 架构说明：https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.zh.md
- Desktop Host patch：https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop-host/config/desktop.cordis.patch.yml
- Desktop 主进程：https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/src/main.ts
- Desktop 项目管理器：https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/src/project-manager.ts

### 4.2 Desktop 的关键架构事实

- Desktop 是 Electron 壳，但不是 localhost URL 套壳；
- 使用 dsh-app:// 私有协议；
- 核心不启动 dsh web，也不把 Harness Web UI/API 暴露为 localhost HTTP 服务；
- Electron、匹配版本的 dsh、准备好的 Node 资源和 pnpm 作为一个发布单元；
- 打包版 Desktop Host 当前由 Electron 可执行文件以 Node mode 启动，打包资源 Node 主要服务于包管理和运行时准备；执行时必须重新核对最新源码；
- dev:desktop 使用当前工作区构建产物和调用命令的 Node，不可用来单独证明自包含发布 runtime 已完成；
- Electron 与 dsh Host 通过分帧字节管道和受控 IPC 通信；
- 当前 Desktop transport 将 /api/* 交给 Connection 的 shared Fetch handler，将 Remote stream 交给专用端点；它不是任意 HTTP 路由注册器；
- Desktop 独占 profiles/desktop；
- 开发模式默认使用隔离的 Harness home 和 Electron userData；
- dev:desktop 当前默认开放 9222 Renderer 调试、9229 Main Inspector 和 9230 Host Inspector；研究时它们预期仅限 loopback，但执行时必须以 lsof/ss 同时核对 IPv4、IPv6 实际绑定地址；这些不是 Harness Web 服务；
- Desktop Host 禁用 web-startup、webserver、web-runtime、client-hmr 等 Web 专用行；
- Electron 保持 nodeIntegration=false、contextIsolation=true、sandbox=true、webSecurity=true；
- 默认拒绝任意 window.open 和非 dsh-app:// 导航；
- 当前插件管理器不接受 file:、link: 或任意本地路径插件；
- 开发入口为 pnpm run dev:desktop；
- Linux 不是官方 Desktop 发布目标；
- 官方公开安装包和生产更新源在研究时尚未上线。

新项目应顺着这些架构工作，不应通过重新开启旧 Web Runtime 来规避迁移。

### 4.3 开发模式与打包模式不能混为一谈

| 维度 | dev:desktop | 打包/未封装应用目录 |
|---|---|---|
| Host 执行器 | 调用开发命令的当前 Node | 研究基线为 Electron 可执行文件 + ELECTRON_RUN_AS_NODE=1 |
| dsh 来源 | 当前 workspace 构建产物和一次性 project | resources/dsh 中准备并校验的生产依赖闭包 |
| Node/pnpm 资源 | 不证明最终自包含资源 | 随发布单元准备，用于受控包管理和运行时工作 |
| 默认 Harness home | apps/desktop/.desktop-build/development/home | 官方默认仍按 DSH_HOME 解析；私有 fork 必须改成 app-owned home |
| 默认 userData | development/electron-user-data | 私有 fork 必须在早期显式 setPath |
| 调试端口 | 默认 9222/9229/9230；执行时核对其仅绑定 loopback | 正式形态不应携带这些开发调试监听 |
| 插件包变更 | 开发模式受限，不能证明真实 Profile 包事务 | 使用内置 pnpm、Profile graph 和 runtime reconciliation |
| 能证明什么 | UI、Host、transport 和功能开发 | production closure、ASAR、原生模块、Profile、私有路径与 updater |

执行者必须分别报告两种形态的结果。dev:desktop 通过不等于自包含 Desktop artifact 已验收。

---

## 5. 目标双轨架构

### 5.1 总体结构

~~~text
┌─────────────────────────────────────────────────────────────┐
│ 现有系统：冻结、继续运行                                    │
│                                                             │
│ launcher → dsh 0.1.1-rc.2 → Web Profile → dsh-diy-lab      │
│                     ├── 127.0.0.1:3080                      │
│                     └── LAN :3091                           │
│                                                             │
│ 现有 ~/.dsh、Key、Workspace、Session、Chrome localStorage   │
└─────────────────────────────────────────────────────────────┘

                         完全无运行时连接

┌─────────────────────────────────────────────────────────────┐
│ 新系统：独立 Desktop Preview fork                           │
│                                                             │
│ Electron                                                    │
│   ├── dsh-app:// Renderer                                   │
│   ├── 官方 Desktop transport / Remote Gateway               │
│   ├── Desktop Host（打包版 Electron Node mode）              │
│   ├── 受控 Node/pnpm 打包资源                               │
│   ├── 私有内置微信 UI package                               │
│   ├── 私有内置微信能力 Host package                         │
│   └── 可选 LAN Collaboration sidecar → 建议 :3191           │
│                                                             │
│ 独立 DSH_HOME、desktop Profile、userData、Key、Workspace     │
└─────────────────────────────────────────────────────────────┘
~~~

### 5.2 推荐的新项目组织

重新 clone 官方仓库后，在该私有 fork 内增加受 monorepo 管理的内置 package。建议按职责拆分，而不是把旧单包原样塞进 Desktop：

~~~text
packages/private/wechat-ui/
  Renderer、微信式布局、会话展示和 Desktop 客户端适配

packages/private/wechat-host/
  Session/Workspace/文件/服务/调度等 Host 侧能力

packages/private/wechat-collaboration/
  LAN 群聊、账号隔离、房间、邀请、附件与协作状态

packages/private/wechat-shared/
  类型、消息模型、纯函数和共享静态资产
~~~

具体目录名可以调整，但应满足：

- 位于新 fork 内；
- 被 pnpm workspace 正常管理；
- private=true；
- 不发布公共 npm；
- 不 symlink 到旧插件目录；
- fork 内第一方 built-in package 按上游惯例使用 workspace:^ 进入同一生产闭包；安装到 writable Profile 的外部插件才应将 Host 共享的 Cordis/dsh 单例包声明为兼容 peer；不得嵌套安装第二份共享运行时；
- 进入受控 Desktop runtime/package set；
- 不通过关闭 Desktop 的插件图校验来强行加载。

如果更小的拆分更容易实现，首版允许用一个内置 package，但必须在代码结构中明确分离 Renderer、Host 和 LAN 服务边界。

仅把目录加入 pnpm workspace 不会自动让微信插件进入 Desktop。执行者必须根据实际上游完成并测试以下集成：

1. 微信 package 声明可被 Harness 识别的 dsh.bundle.patch；
2. package 从 @deepseek-ai/dsh、@deepseek-ai/dsh-desktop-host 的生产闭包可达，或显式扩展 Desktop package-set 根；
3. 扩展 Desktop 内置 bundle 列表、Profile 创建/恢复逻辑及相应测试；
4. 更新 runtime shared-package inventory、打包输入、依赖约束与 payload smoke；
5. 确认微信 UI 与必要 Host package 属于私有发行版的 built-in composition，不作为 writable Profile 中可被普通插件管理器卸载的外部依赖。

微信式/原生式切换应优先由内置 bundle 自己的配置或 slot 开关实现，不应依赖插件管理器卸载和重装内置 bundle。

---

## 6. 六层强制隔离

### 6.1 Git 和源码隔离

- 重新 clone 官方仓库；
- 不复用现有 rc.2 checkout；
- 本次调研产生的 /Users/gene/Documents/Codex/2026-09-16/wo-ka/work/deepseek-harness-upstream 也只是一份只读研究副本，不应直接变成最终项目；请创建新的独立 Codex Project/仓库目录；
- 记录 upstream URL、branch、exact SHA、版本、Node 和 pnpm 要求；
- 从固定 SHA 建立独立开发分支，例如 desktop-wechat-port；
- 首个可运行版本完成前不持续追 master；
- 从旧插件复制所需源码，不使用 symlink、file: 或 link: 指向旧目录；
- 不复制旧 .git；
- 新 lockfile、构建产物和运行代码不得含旧路径；
- 每个阶段建立独立 commit，方便回退和后续 rebase。

### 6.2 DSH_HOME 隔离

新项目必须显式使用独立 DSH_HOME。修改 productName、app ID 或安装目录本身并不会改变官方打包版默认的 Harness home。

即使官方 dev:desktop 默认写入：

~~~text
apps/desktop/.desktop-build/development/home
~~~

也要从运行日志、进程环境和打开文件确认实际路径。

私有打包版不能只依赖启动它的 shell 提供 DSH_HOME。主进程必须在首次解析 Desktop 路径、取得 Profile 锁或启动 Host 之前，计算一个属于本应用的绝对 Harness home，并把同一个值传给：

- Desktop 项目/Profile 管理器；
- Host 子进程；
- 内置包管理器；
- collaboration sidecar；
- 所有需要解析产品数据目录的服务。

从 Finder、Dock 或 open 启动、且调用环境没有 DSH_HOME 时，也必须落到这个私有 app-owned harness-home。若解析结果指向旧 ~/.dsh、旧 Profile 或旧工程目录，应 fail closed，而不是继续启动。

严禁新 Desktop 使用：

~~~text
~/.dsh
~/.dsh/profiles/web
~~~

原因不只是插件 Profile 不同。新版可能在写入时发布当前 V3 generation，并产生 rc.2 不认识的事件或结构；旧版可能拒绝新的最高 generation。即使历史源文件仍保留，共享 Harness home 也不是受支持的双版本降级方案，而且 settings、credentials、workspace state 和进程锁仍会交叉。

新 Desktop 首次启动必须满足：

- 无旧会话；
- 无旧任务；
- 无旧工作区；
- 无旧 Provider 配置；
- 无旧 Key；
- 无旧插件状态；
- 无旧群聊；
- 无旧 UI 状态。

### 6.3 Electron userData 隔离

以下内容必须使用新应用自己的目录：

- Electron userData；
- Cache；
- Local Storage；
- IndexedDB；
- Cookies；
- Session storage；
- DevTools preference；
- 日志和 crash dump。

不得复用 Chrome 的数据，也不得与未来官方正式 Desktop 共用应用 ID 或 userData。

打包 fork 应在取得单实例锁和创建窗口之前，显式调用 Electron 的 userData 路径设置能力，固定私有目录，并在诊断页记录运行时实际 userData。不能只根据 productName 恰好不同来推断隔离。

建议为私有 fork 使用独立：

- productName，例如 DeepSeek Harness WeChat Preview；
- 一个与官方 Desktop 不同、稳定的私有 reverse-DNS app ID；用户未指定时由执行者选择合理开发 ID 并记录，正式签名或分发前再确认最终名称；
- single-instance identity；
- userData namespace；
- credential/keychain service namespace；
- 日志 namespace；
- 更新频道。

私有预览阶段必须在代码和 builder 配置中真正关闭官方自动更新，不得指向官方 DeepSeek 更新源：

- 私有构建不携带官方 publish/feed；
- 主进程不自动调用官方更新检查；
- 菜单不访问官方更新通道；
- 构建产物中不应出现官方 Desktop 更新 URL；
- 未来启用更新时使用独立 app identity、URL、channel、签名和版本序列。

### 6.4 Workspace 隔离

- 首次启动使用空白状态；
- 由用户在新 Desktop 中新选 Workspace；
- 不默认打开旧 Harness 源码、旧用户项目或本 Desktop 仓库；
- 不通过 symlink 指向旧 Workspace；
- 新群聊使用新的显式白名单沙盒；
- 不复制 office-test-workspace 的运行状态；
- 新 Key 由用户在新 Desktop 中单独录入，或由用户明确为新项目提供 scoped environment credential；
- 不得从旧 Profile、旧 .env、旧 Keychain service 或普通调用环境中无意继承凭据；Host 应使用环境白名单，只允许用户明确为新项目提供的 scoped credential；LAN sidecar、DesktopProjectManager.runPnpm 及其获准执行的 lifecycle/build scripts 应剥离全部 Provider 凭据环境变量；
- Key 只允许在用户输入和提交期间短暂存在于受控 Renderer 内存与强类型请求中；
- Key 不得持久化到 Renderer localStorage、IndexedDB、Cookie、URL、日志、截图、崩溃报告、群聊数据或 Git；
- 提交成功后清空输入状态，持久化只由 Host credential storage 完成，LAN 客户端永远不得接触 Key；
- 如果用户尚未提供新 Key，先完成构建、fixture/mock、UI、Host、隔离和群聊非 AI 测试；到真实 Provider 验收点时请求新的测试 Key，严禁读取旧凭据或把未执行的真实模型测试标为通过。

### 6.5 端口和网络隔离

官方 Desktop 核心必须继续走 dsh-app:// 和 Desktop transport，不能为了省事重新启动一个 3080 式核心 Web Server。

LAN collaboration sidecar 是新应用功能层唯一额外的常驻网络服务。以下情况不应误判为旧式 Harness Web：

- dev:desktop 官方默认的三个调试端口（执行时须确认仅绑定 loopback）；
- 用户在新 Workspace 中显式启动、且由服务管理器清楚归因的工作区服务。

打包/生产式形态不得存在 dsh web 或 Harness HTTP UI/API 服务。LAN sidecar 要求：

- 禁止使用 3080、3091、5226；
- 建议默认使用 3191，并允许用户配置；
- 启动前检查端口占用；
- 使用独立实例 ID、服务名和数据目录；
- 不代理、不调用、不发现旧 3080/3091；
- 默认不监听 LAN；
- 只有用户明确打开“局域网群聊”后才绑定局域网地址；
- 用户关闭 LAN 模式后完全停止 HTTP/WebSocket/SSE listener 并释放端口；Desktop 内群聊继续通过 dsh-app://、Connection 和 Remote 与 Host 交互；
- 通过应用菜单 Quit 或 Cmd+Q 完整退出 Desktop 后自动释放新端口；macOS 仅关闭窗口不等于退出应用；
- 只暴露协作 API，不暴露 Desktop Host、Key、任意文件读取或任意命令执行；
- Renderer 中所有端口和 URL 都来自新实例配置，不保留硬编码 3091。

群聊网络层首选 Desktop Host 管理的受控独立子进程/sidecar：

- 使用清理后的环境，不继承 Provider Key、旧 DSH_HOME 和 npm/pnpm 状态；
- 使用独立 working directory 与数据目录；
- 与 Host 之间只有窄的、强类型、带房间/账号授权的 IPC；
- 不向网络层暴露完整 Cordis Context、Remote Gateway、任意 Session API 或文件系统。

同进程 http.Server 可以作为备选，但由于它与 Host 凭据和文件能力处于同一高权限进程，必须经过额外威胁建模、接口审计与负面安全测试。

无论采用哪种方式，都不得重新启用官方已禁用的完整 webServer/web-runtime。

### 6.6 依赖和构建隔离

- 使用官方仓库声明的 Node 与 pnpm/Corepack；
- 不修改系统全局 Node；
- 不复用旧 Profile 的 node_modules；
- 不复制旧 package-lock.json 或 pnpm-lock.yaml；
- 锁定新项目依赖；
- 保留 strictDepBuilds/allowBuilds 等官方供应链策略；
- 不为兼容插件而关闭 sandbox、contextIsolation、webSecurity；
- 不开启 nodeIntegration；
- 不加载第二份 rc.2 Cordis 或 client runtime；
- 原生能力通过当前官方 Remote、preload/IPC 或 Desktop Host 边界实现。
- 不假定 process.execPath 在开发和打包形态中都指向同一种 Node；涉及子进程或原生模块时，分别验证当前 Node ABI、Electron Node mode、打包资源 Node 和目标平台产物。

---

## 7. 旧能力到新架构的映射

| 现有实现 | 新 Desktop 目标 |
|---|---|
| dsh web :3080 | Electron + dsh-app://；无 Harness HTTP UI/API，开发调试端口另行记录 |
| ~/.dsh/profiles/web | 独立 DSH_HOME 下的 profiles/desktop |
| dsh-diy-lab link: | 私有 fork 内置 workspace package |
| @deepseek-ai/dsh-client-runtime | 当前拆分后的 client/session/store/connection 包 |
| connection.api.* | 当前 Remote Gateway/Controller API |
| ctx.apiProxy | 当前 Session Controller/Remote 服务 |
| ctx.webServer 本机业务路由 | 当前 Typert Gateway/Connection 的强类型 API 与 Remote stream |
| ctx.webServer 中需要 LAN 浏览器访问的路由 | 独立 collaboration sidecar 的最小 HTTP/WebSocket/SSE API |
| shell.overlay | 当前 Desktop 客户端 slot/layout 扩展点 |
| conversation 旧 slot | 当前 main/conversation 或执行时实际 slot |
| window.open | 应用内 tab；确需系统能力时在 fork 中新增窄范围 preload-app/IPC/BrowserWindow |
| Chrome localStorage | 新 Electron userData 中的命名空间存储 |
| 3091 | 新实例的可配置端口，建议 3191 |
| .collab-data | 新 DSH_HOME/app data 下的空数据目录 |
| .schedule-data | 新 DSH_HOME/app data 下的空数据目录 |
| .file-data | 新 DSH_HOME/app data 下的空数据目录 |
| cordis.patch.yml 绝对路径 | 基于 owned directory/DSH_HOME 的可移植配置 |
| 旧浏览器独立窗口 | Desktop 受控多窗口或应用内标签 |
| Web 外部链接 | allowlist 校验后交给系统浏览器 |

执行时不要假定上表中的当前包名仍完全准确。应通过最新源码、类型声明、Catalog 和现有官方插件寻找当时正确的 API。

---

## 8. 已知必须重构的接口

### 8.1 Client Runtime

旧插件依赖：

~~~text
@deepseek-ai/dsh-client-runtime/client
@deepseek-ai/dsh-client-ui-slots
@deepseek-ai/dsh-client-ui-layout
@deepseek-ai/dsh-client-ui-conversation
~~~

其中旧 dsh-client-runtime 已被移除。当前上游已拆成 Session Controller、Connection、Store、UI Session、UI Chat、UI Layout、Workspace 等包。

要求：

- 不复制旧 runtime 包；
- 不安装一套 rc.2 runtime 到 Desktop；
- 不创建双 Context 或重复 Cordis 服务；
- 从最新官方 Client package 和现有扩展中寻找正式接入方式；
- 遵循目标 package 当前的语言与构建规范；在 Renderer、Host 和 Remote 边界建立可验证的类型或运行时 schema，不得用大范围 any、unknown as 或关闭类型检查掩盖不兼容；
- 不要求为了本任务把全部旧 JavaScript 整体重写成 TypeScript；
- 更新 slots.ts 和所有 module augmentation。

### 8.2 APIProxy 和 Session

旧插件当前使用的调用包括但不限于：

~~~text
ctx.apiProxy.sessions.prompt
connection.api.sessions.history
connection.api.sessions.models
connection.api.subagents.history
connection.api.agentPresets.list
ctx.sessions.binding
ctx.sessions.open
ctx.sessions.refreshSubagents
ctx.sessions.setSubagentCatalogOpen
ctx.sessions.noteAgentPreset
ctx.workspaces.*
ctx.remote.commands.*
ctx.remote.pluginInventory.*
~~~

旧 APIProxy 已被上游移除。

要求：

- 改用当前 Remote Gateway、Session Controller 和 Workspace Controller；
- 适配 SessionHandle、锁和 V3 日志；
- 使用当前按需历史 API；
- 避免为 UI 列表重复读取完整历史；
- 不建立兼容 shim 去访问旧 3080；
- 对已被移除且无直接替代的能力，先查找最新官方实现，再设计等价适配；
- 不允许静默删除功能。

### 8.3 Web Server

旧插件注入：

~~~text
agents
apiProxy
jobs
sessions
webServer
~~~

并向 webServer 注册：

- scheduler routes；
- file server routes；
- service routes。

Desktop Host 明确禁用 Web Server。当前 Host 不是任意路由注册器，本机业务能力应进入 Connection/Typert 的强类型 API 或 Remote stream。整体应拆成：

~~~text
微信式 Renderer
      │
      ▼
官方 Remote / Desktop transport
      │
      ▼
Desktop Host 私有能力
      ├── Session / Workspace / 文件 / 调度 / 服务
      └── 可选 LAN Collaboration sidecar
~~~

Desktop 本地 UI 的能力不能通过 localhost API 绕回去。只有局域网成员访问群聊时才使用新 collaboration 端口。

### 8.4 插件安装

官方 Desktop 当前不接受 file:、link: 或任意本地插件路径。

推荐做法：

- 将微信相关 package 作为私有 fork 的第一方 workspace package；
- 声明 dsh.bundle.patch，并通过官方 composition 机制启用；
- 让它从 dsh/Desktop Host 生产依赖闭包可达，或显式扩展 Desktop package-set 根；
- 扩展内置 Desktop bundle 列表，以及 Profile 创建、Reset/Repair、禁用外部插件和验证测试；
- 更新 runtime shared-package inventory、打包输入、依赖约束和 payload smoke；
- Host 共享单例包按官方规则使用兼容 peer，其他内部依赖使用 workspace/catalog 规范；
- 保留官方插件图与 package graph 验证。

微信 UI 与必要 Host package 必须是私有发行版的 built-in composition，不是 writable Profile 中可被普通插件管理器删除的第三方包。执行官方 Reset/Repair 后，应重新建立空白微信式 Desktop，微信壳和群聊入口仍存在；Reset 的数据语义仍以官方行为为准。

不推荐：

- 发布私有代码到公共 npm；
- 修改插件管理器以接受任意绝对路径；
- symlink 到旧 dsh-diy-lab；
- 全局关闭 Desktop 插件图校验；
- 把旧 Profile 整体复制进 Desktop。

### 8.5 多窗口和外部页面

旧代码存在多个 window.open：

- 独立会话；
- 文件或 Blob；
- 服务 URL；
- 网页预览；
- 可视化独立打开。

官方 Desktop 默认拒绝 window.open。当前应用页面使用的 preload-app 只暴露极小协议标记，并没有现成的通用窗口、shell、文件或任意 Electron IPC 扩展点。

迁移策略：

- 会话：优先应用内 tab；
- 若确需系统浏览器、保存对话框或第二 BrowserWindow，在 fork 中新增窄范围 preload-app API、对应 IPC schema 和主进程 handler；
- 每个 IPC 方法逐项校验 sender、协议、URL/路径和业务权限，不向 Renderer 暴露 raw ipcRenderer、shell、文件系统或任意窗口参数；
- 新建 BrowserWindow 必须继承 nodeIntegration=false、contextIsolation=true、sandbox=true、webSecurity=true 以及导航/window.open 拦截；
- 外部 HTTPS 页面：校验协议和 allowlist 后再交给系统浏览器；
- Blob/文件：通过新增的窄范围 Desktop 文件交付/保存能力；
- 可视化：保留 sandbox iframe，必要时用独立受控窗口；
- 不允许全局放开任意 window.open；
- 不允许任意页面导航主窗口；
- 保持 CSP、sandbox 和 webSecurity。

### 8.6 浏览器状态

旧插件大量使用 localStorage，包括：

- 微信/原生界面模式；
- 用户头像与昵称；
- 会话头像和副标题；
- 置顶、隐藏、排序和归档；
- Persona；
- 消息回收站；
- 只看真人消息；
- 预览沙箱的受限状态。

这些是需要复用的“功能”，不是要迁移的“数据”。

新 Desktop 要：

- 使用自己的空白存储；
- 保留合理默认值；
- 为 key 增加新应用 namespace/schema version；
- 对重要状态提供迁移版本控制；
- 不读取 Chrome localStorage；
- 不尝试从旧页面导出；
- 对安全相关数据优先使用 Host storage，而不是无保护 Renderer localStorage。

---

## 9. 功能迁移范围

开始编码前，必须根据当前旧插件源码和真实 3080/3091 UI 建立 CAPABILITY_MATRIX.md。先给每项能力标注来源和证据级别：

- verified-current：由当前源码和实际运行态确认存在，属于 P0/P1 兼容目标；
- historical-doc-only：只在旧 README/HANDOFF 中出现，必须经当前源码或实际 UI 验证后才能进入 P1；
- new-required：用户本轮明确要求，即使旧版没有也属于新项目范围；
- not-present：当前实际没有实现，不属于“能力复用”，可进入 P2 产品增强；
- upstream-native：新版 Harness 已原生提供，应直接接入，不要求微信插件重写；
- third-party：来自外部插件，仅在微信核心流程硬依赖时进入本轮。

以下清单是调查下限，不代表历史文档中的每一项已经被验证。

### 9.1 微信式 Shell 和导航

- 微信桌面版风格的主 Shell；
- 左侧图标导航；
- 图标排序、隐藏、滚动；
- 用量、设置和常用入口；
- 中间会话列表；
- 工作区视图/最近会话视图；
- 搜索、新会话；
- 会话分组；
- 可折叠会话栏；
- 深色模式；
- 插件管理、插件商店、任务看板、Web UI 插件、皮肤和宠物等既有导航入口的兼容结论；
- 微信式/原生 UI 模式切换优先实现为内置 bundle 自己的 slot/layout 配置，不依赖插件管理器卸载内置 bundle；
- 空数据首次启动体验。

### 9.2 会话管理

- 创建无工作区或指定工作区的会话；
- 打开、切换和排序；
- 主标题、副标题；
- 会话头像；
- 置顶；
- 已读/未读；
- 隐藏/安全移除；
- 归档和恢复；
- 消息回收站；
- 现有消息转发/ForwardDialog 行为；
- 最近消息摘要；
- 运行中、完成、等待回答状态；
- 独立会话窗口的 Desktop 等价能力；
- 不依赖旧 Session ID。

### 9.3 对话体验

- 用户消息在右、助手消息在左；
- DeepSeek 头像与自定义头像；
- 流式思考与正式回答；
- reasoning 展开/折叠；
- 多 step 展示；
- 工具状态；
- 回到底部；
- Markdown/GFM 安全渲染；
- 链接识别；
- 复制单条消息；
- 时间分隔与点击查看精确时间；
- 初始化 context 折叠；
- 取消生成；
- 追问问题卡与继续执行；
- 中文界面规则注入，但不显示在用户气泡中。

### 9.4 Agent、Subagent 和原生控制

- Agent/Subagent 列表和历史；
- Subagent 刷新与状态；
- 模型选择；
- reasoning effort；
- Agent preset；
- Persona/会话记忆；
- 权限预设和二次确认；
- Workspace；
- Git 分支；
- Commands；
- Jobs；
- 任务看板或新版原生等价入口；
- 插件清单和插件状态；
- 当前官方 Sidebar、终端、文件预览能力的接入。

对新版已经原生提供得更好的能力，应优先复用官方实现，只保留微信式入口和交互，而不是复制一套旧实现。目标是“用户能力等价或更好”，不是逐行搬运旧代码。

### 9.5 文件、图片和可视化

- PNG、JPEG、WebP、GIF；
- 多选、拖放、截图粘贴；
- 图文同时发送；
- 发送前预览和移除；
- 历史图片；
- 全屏大图；
- 通用文件附件；
- 敏感文件拒绝；
- 文档文本提取作为低优先级材料；
- 下载鉴权；
- Markdown、代码、HTML、PDF、图片预览；
- visualize_html 安全 iframe；
- 右侧预览；
- 沉浸模式；
- 可视化复制/导出能力；
- iframe 存储桥必须继续限制允许的 key；
- 不暴露绝对路径。

### 9.6 服务、调度和用量

- 运行服务清单；
- 当前进程/端口/来源会话；
- 打开、刷新和确认停止；
- 定时任务；
- 用量与费用；
- 按时间范围、会话和模型聚合；
- 兼容新版 token 统计；
- 不把旧 .schedule-data 带入新项目。

### 9.7 第三方插件策略

旧 Web Profile 中存在 GenUI、Visualize、Context、Task Board、Git Graph、Skins、Pet 等插件。

本任务不等于复制整个旧 Web Profile。处理原则：

- 如果某项能力已经成为微信插件核心体验，必须在能力矩阵中列出；
- 如果新版 Harness 有原生等价能力，改接原生；
- 如果第三方插件有兼容新版的版本，可在独立 Desktop Profile 中重新安装并锁定；
- 如果不兼容，明确记录为后续项或用内置能力替代；
- 不允许为了一个非核心插件把旧 runtime 带入 Desktop；
- 不迁移任何第三方插件数据。

首个 P0 版本不应被皮肤、宠物等装饰功能阻塞；但最终“完整能力复用”验收前，每一项都要在矩阵中有明确结论。

---

## 10. 微信式群聊迁移要求

群聊不是可选的附带页面，而是本任务的核心交付物之一。

### 10.1 Desktop 宿主体验

本轮群聊 P0 是：Desktop 内群聊入口、全新房间、至少两个客户端收发消息、使用新 Desktop Key/Workspace 的 AI 参与、独立数据和完整生命周期。其余旧项目细节先按证据级别进入能力矩阵。

- 微信式会话列表同时显示私人会话与多人群聊；
- 群聊入口直接存在于 Desktop UI；
- Desktop 用户不需要为群聊再打开本机浏览器；
- 可从新会话选择单人/多人；
- 若当前 3080/3091 的实际代码和运行态确认支持，则 P1 等价迁移“私人会话转多人”及“从现在开始 / 分享摘要 / 分享完整历史”等范围选择；否则列入 P2 产品增强；
- 可管理邀请、成员、角色、权限和协作模式；
- 群聊使用新 Desktop 自己的 Session、Key 和 Workspace；
- 绝不桥接旧 3080 Session。

### 10.2 LAN 参与者体验

LAN 参与者仍可以通过新实例的群聊 Web 页面加入，这是群聊 sidecar 唯一合理的网络入口。

除 §10.1 已定义的群聊 P0 外，下面更细的账号、邀请、多房间、私人会话和实时体验均应按当前 3091 源码与运行态证据进入 P1；实际不存在的项目进入 P2，不能只凭历史文档宣称已迁移。

要求：

- 使用新端口，建议 3191；
- UI 延续微信式布局；
- 在安全边界允许时优先共享类型、消息模型、设计 token 和纯展示组件；Desktop 与低权限 LAN 页面可以有独立入口和适配层，验收关注体验/协议一致与权限隔离，不要求零重复组件；
- 支持账号隔离；
- 支持邀请码和可选房间密码；
- 支持多个房间；
- 已登录账号打开新邀请时可以加入对应房间，而不会覆盖已加入的其他房间；
- 支持 LAN 账号自己的私人 Harness 会话，并将其文件执行限制在该账号的新隔离 Workspace；
- 支持在线状态；
- 支持群头像和个人头像；
- 支持图片与文件；
- 支持实时消息、AI 进度、问题卡和工具状态；
- Bundle 版本变化后可安全刷新；
- 旧 3091 同时运行时不冲突。

### 10.3 待核实的现有协作模式

下列模式来自旧项目资料和当前源码线索。阶段 0 必须通过实际工作树的路由、状态模型、测试和当前 3091 UI 逐项确认。确认当前已实现的模式进入 P1 兼容范围；仅有历史文档描述、当前没有实现的内容进入 P2，不得冒充“现有能力迁移”。

1. 群聊模式：成员聊天，AI 不收集、不回复、不执行；
2. 普通讨论：AI 以只读权限择机参与；
3. 协作执行：收集需求、冲突检测、静默等待、确认后以 workspace-write 执行；
4. 应用服务：在隔离工作区生成或更新受限群应用。

对经验证当前已实现的模式，同时核对并保留以下行为：

- 成员参与/对 AI 静默；
- 确认规则；
- 静默窗口；
- 冲突或需求确认卡；
- 运行中消息进入下一轮；
- 群主/管理员停止执行；
- 结构化追问；
- 断线重连和历史补齐；
- 只看真人消息；
- 群应用安全沙箱；
- 内部权限切换指令和默认确认不应混入共享群消息，真实需求后的思考、回答、工具状态与追问仍应同步；
- 私人会话与多人房间隔离；
- 新 Desktop 可用仅宿主可见的虚拟分组整理协作 Session，但这些分组不得伪装成或泄露真实文件 Workspace。

### 10.4 群聊数据与安全

新群聊必须使用空的新数据目录。建议放入新 Desktop owned directory 或独立 DSH_HOME 的产品目录，不要继续写进源码树。

最低安全边界：

- 数据和附件文件使用最小权限；
- API 响应不返回绝对路径；
- 附件端点验证用户与房间关系；
- 邀请、角色、历史分享范围在服务端校验；
- API Key 只允许 Desktop 本地管理，不向 LAN 用户暴露；
- 普通 LAN 用户不能修改 Provider 凭据；
- LAN 私人会话响应不得暴露宿主账号、内部 Session ID、绝对路径或其他账号数据；
- 私人 Workspace 下载只允许导出该账号的白名单内容，并排除凭据、Git 元数据、依赖目录和符号链接；
- 群应用不能访问凭据、其他 Session 或白名单外文件；
- 禁止符号链接逃逸；
- Workspace 下载排除 .env、密钥、证书、.git、依赖目录及其他用户文件；
- 预览使用严格 CSP 和 sandbox；
- 只在用户明确启用后监听 LAN；
- 日志脱敏；
- 通过应用菜单 Quit 或 Cmd+Q 完整退出 Desktop 后服务停止；仅关闭 macOS 窗口时按明确的后台驻留策略处理；
- 崩溃重启时回收残留 running 状态。

### 10.5 新端口策略

默认建议：

~~~text
旧系统
  3080 现有 Harness Web
  3091 现有 LAN 群聊
  5226 现有启动入口

新系统
  开发模式：9222 Renderer debug、9229 Main Inspector、9230 Host Inspector
             均为当前官方默认调试端口，执行时以 lsof/ss 重新核对 IPv4/IPv6 绑定并记录
  打包模式：无 dsh web / Harness HTTP UI/API
  3191 新 LAN 群聊，允许配置
~~~

如果 3191 已占用：

- 清晰提示占用进程；
- 允许用户选择其他端口；
- 不自动杀进程；
- 不自动回退到 3091；
- 保存到新 Desktop 自己的配置。

---

## 11. 能力矩阵模板

开工后先建立 CAPABILITY_MATRIX.md，至少使用以下字段：

| 字段 | 说明 |
|---|---|
| 能力 | 用户可感知的功能 |
| 来源 | dsh-diy-lab / upstream / 第三方插件 / 历史文档 / 本轮新需求 |
| 证据级别 | verified-current / historical-doc-only / new-required / not-present / upstream-native / third-party |
| 优先级 | P0 / P1 / P2 |
| 旧源码位置 | 文件和关键函数 |
| 旧 API/依赖 | apiProxy、webServer、旧 client runtime 等 |
| 最新官方等价能力 | 新 package、Controller、Remote 或原生 UI |
| 新实现位置 | 新 fork 内的文件 |
| 数据策略 | 新建、持久化位置、是否敏感 |
| 状态 | 未开始 / 进行中 / 已适配 / 被阻塞 / 明确不需要 |
| 自动测试 | 对应测试文件和命令 |
| 人工验收 | 可复现步骤 |
| 证据 | 截图、日志、测试输出或 commit |
| 差异说明 | 与 3080 的有意差异 |

不允许因为旧 API 被移除就静默删掉功能。

确实无法在当前 Desktop Preview 实现时，必须记录：

1. 阻塞原因；
2. 官方缺失的接口；
3. 已尝试方案；
4. 安全替代方案；
5. 对用户体验的影响；
6. 后续跟进条件。

---

## 12. 分阶段实施计划

### 阶段 0：冻结事实与建立证据

任务：

1. 只读记录 3080、3091、5226 的进程、端口和健康状态；
2. 记录旧插件 Git HEAD、git status 和源码文件清单；
3. 对需要复制的源码生成哈希清单；
4. 记录旧 Profile 插件清单，但不读取或复制密钥；
5. 建立初始能力矩阵；
6. 在线核对最新官方 Desktop Release/tag、master 与 CI；
7. 按本文基线选择规则确定可构建 SHA，并原样验证；
8. 记录最新 HEAD、实际采用 SHA、版本、Node/pnpm 要求、Host 启动方式和支持平台；
9. 将历史文档能力与当前实际实现分级；
10. 选择全新的项目目录；
11. clone 官方仓库并创建私有开发分支。

验收：

- 有明确 upstream SHA；
- 有旧系统只读基线；
- 有能力矩阵初稿；
- 已记录旧 3080/3091/5226 当时的健康状态；本任务没有主动停止、重启或配置它们；
- 旧目录没有因本任务产生写入。

### 阶段 1：先跑通原版 Desktop

在任何微信代码进入前，先验证官方原版。

任务：

1. 按官方要求安装项目依赖；
2. 使用 pnpm run dev:desktop；
3. 确认开发状态位于隔离目录；
4. 确认页面通过 dsh-app:// 加载；
5. 确认没有 dsh web/Harness HTTP UI/API；记录并正确识别官方默认的 9222、9229、9230 调试端口，核对它们只绑定 loopback；
6. 完成一次空白状态启动；
7. 创建一个全新的 disposable test workspace；若已有新的测试 Key，可通过官方凭据 UI 配置，否则先运行不需要真实 Provider 的测试；
8. 运行与 Desktop 相关的官方测试。

验收：

- 未修改的官方 Desktop 能启动；
- 看不到旧会话、Key 或 Workspace；
- 旧系统没有被本任务写入、停止、重启或占用端口；
- 有原版启动日志与截图；
- 没有将官方基线问题误判为微信移植问题。
- 明确标注 dev:desktop 使用当前开发 Node/workspace symlink，尚不能证明自包含打包 runtime。

### 阶段 2：导入干净的能力源码

从旧工作树只读复制必要源码。建议纳入：

- src/client 中的可维护源码；
- src/collab 中的可维护源码和测试；
- Host 侧 file/service/scheduler 源码；
- CSS、图标和默认静态资产；
- 构建配置中仍有参考价值的部分；
- 与能力相关的测试；
- README 中的功能说明，作为迁移参考。

明确排除：

- .git；
- node_modules；
- lib 和其他可重建产物；
- .collab-data；
- .schedule-data；
- .file-data；
- backups；
- 日志；
- 旧 cordis.patch.yml 实例配置；
- office-test-workspace 的用户运行状态；
- Key、Profile、Cookie、localStorage；
- 旧绝对路径和旧 IP。

导入后：

- 用新项目格式化和类型规范重组；
- 标记原始来源；
- 生成 SOURCE_IMPORT_MANIFEST.md；
- 确认没有运行时引用旧目录。

### 阶段 3：迁移微信式 Renderer

推荐顺序：

1. 用模拟数据渲染微信式 Shell；
2. 接入当前 Slots/Layout；
3. 接入当前 Session list；
4. 接入创建、打开、切换；
5. 接入消息流、reasoning 和工具状态；
6. 接入发送、停止、追问；
7. 接入模型、preset、权限和 Workspace；
8. 接入附件与右侧预览；
9. 接入设置和新 Storage；
10. 替换全部 window.open。

验收：

- 不再依赖旧 rc.2 客户端包；
- Renderer 保持安全配置；
- 空状态、有会话、流式生成、等待回答均正常；
- UI 默认进入微信式体验；
- 主要窗口尺寸下无关键遮挡；
- 不读取旧 localStorage；
- 不连接 3080/3091。

### 阶段 4：迁移 Host 能力

任务：

1. 移除 apiProxy；
2. 移除对官方 webServer 的依赖；
3. 将文件、服务、调度等内部功能改成当前 Connection/Typert 强类型 API 或 Remote stream；
4. 适配 Session、Subagent、Workspace、Commands、Jobs、Plugin Inventory；
5. 接入新版附件和文件预览；
6. 接入当前原生 Sidebar/Terminal 等可复用能力；
7. 为能力矩阵的每个 P0/P1 项补证据；
8. 增加单元和集成测试。

验收：

- 源码中没有旧 APIProxy 和 dsh-client-runtime；
- 没有为兼容而启用完整 Web Runtime；
- 没有未解释的 P0 空项；
- 每项已完成能力都经过实际运行；
- 新代码和产物不包含旧路径。

### 阶段 5：迁移群聊和 LAN sidecar

推荐顺序：

1. 先在 Desktop 内用新存储跑通空白群聊；
2. 接入新 Desktop Session bridge；
3. 接入实时事件、历史和追问；
4. 接入邀请、房间、成员和权限；
5. 接入 P0 群聊核心，并对已验证为现有能力的协作模式做 P1 迁移；
6. 接入图片、文件和可视化；
7. 接入外部 LAN 页面；
8. 接入启停、端口检测和生命周期；
9. 执行安全测试；
10. 与旧 3091 同时运行。

验收：

- Desktop 内能直接进入群聊；
- 新服务不占用 3091；
- 新服务不调用旧 3080；
- Desktop 本地 Renderer 作为一个客户端，第二个独立浏览器 profile 至少通过本机实际 LAN IP 加入并收发消息；有第二台设备时再做真实跨设备确认；
- 新群中没有旧房间、旧成员或旧消息；
- AI 使用新 Desktop 的 Session、Key 和 Workspace；
- 本地模式不暴露 LAN；
- 通过应用菜单 Quit 或 Cmd+Q 完整退出 Desktop 后新端口释放；
- 旧 3080/3091/5226 未受影响。

### 阶段 6：共存与打包验证

任务：

1. 生成本机架构的开发可运行版本；
2. 在具备官方要求的签名凭据时，生成真实 unpacked/packaged artifact；没有凭据时将 artifact 验收明确标记为受阻，不用 dev 模式冒充；
3. 使用独立 productName、app ID、single-instance identity、userData 和 credential service；
4. 清除调用 shell 的 DSH_HOME 后，通过 Finder、Dock 或 open 启动私有 App；
5. 验证 Host、项目管理器、包管理器和 sidecar 都使用私有 app-owned Harness home；
6. 验证构建不含官方更新 feed，且不会调用官方更新检查；
7. 完整执行冷启动；
8. 新录入 Key；
9. 新建 Workspace；
10. 创建普通会话和群聊；
11. 执行 Desktop Reset/Repair，确认内置微信壳与群聊入口恢复且不链接旧插件；
12. 通过应用菜单 Quit 或 Cmd+Q 完整退出并检查残留进程；
13. 再次记录旧 3080/3091 的健康状态；
14. 编写运行、构建、升级和回滚文档。

首版不要求：

- Apple 正式公证；
- 正式自动更新托管；
- 公共 npm 发布；
- 与旧 3091 互通；
- 迁移任何历史资产。

如果官方打包脚本要求生产签名条件，不能通过关闭安全检查伪造“正式包”。研究基线下，macOS 的 package 和 app-directory 目标都要求签名身份、Team ID 和公证凭据；只有 Windows 有官方 unsigned 测试目标。

没有 Apple 凭据时可以交付清晰标记的 dev:desktop 功能里程碑，并把真实 artifact 验收标为待凭据；或者在私有 fork 另增名称清晰的 fork-only unsigned/internal mac target，但不得放宽官方签名 target，也不得把它算作官方 release qualification。无论哪种情况，都必须明确 dev 成功尚未证明 production closure、ASAR、原生模块、Profile reconciliation、私有 DSH_HOME/userData 和 updater 配置。

---

## 13. 测试计划

### 13.1 官方基线测试

- 官方原版 dev:desktop 启动；
- Desktop 自带相关单元测试；
- 构建、类型检查和 lint；
- dsh-app:// 资源加载；
- Host 启停；
- 记录 9222、9229、9230 等官方开发调试端口，并确认没有 dsh web/Harness HTTP UI/API；
- 通过应用菜单 Quit 或 Cmd+Q 完整退出后无残留 Host。

### 13.2 微信 UI 测试

- 空状态；
- 新建会话；
- 发送文本；
- 流式思考和回答；
- 停止；
- 结构化追问；
- 历史分页；
- 会话切换；
- 置顶/隐藏/归档；
- 标题、副标题、头像；
- 模型和推理强度；
- Workspace；
- Subagent；
- 文件和图片；
- Markdown 和工具卡；
- 右侧预览；
- 深色模式；
- 窗口缩放；
- 新 Storage 持久化；
- 不读取旧 localStorage。

### 13.3 群聊测试

- 新实例初始化；
- 新账号；
- 邀请加入；
- 多房间；
- P0 新房间、消息和新 Key/Workspace 的 AI 流程；
- 经阶段 0 验证确实存在的协作模式；
- 成员静默/参与；
- 需求确认；
- 冲突退回；
- 静默倒计时；
- AI 执行；
- 运行中消息进入下一轮；
- 停止 Agent；
- 结构化追问；
- WebSocket/SSE 断线重连；
- 历史补齐；
- 图片、文件和预览；
- 群应用 CSP/sandbox；
- LAN 开关；
- 端口占用；
- LAN IP 而非只用 loopback 的第二客户端加入；
- 通过应用菜单 Quit 或 Cmd+Q 完整退出后释放端口；
- 崩溃后残留 running 回收。

### 13.4 双栈共存测试

在旧 3080、3091、5226 可用时：

1. 启动新 Desktop；
2. 在新 Desktop 发起普通对话；
3. 创建第二个会话；
4. 启动新 LAN 群聊；
5. 让第二个独立浏览器 profile 至少通过实际 LAN IP 加入并收发消息；有第二台设备时完成真实跨设备确认；
6. 通过应用菜单 Quit 或 Cmd+Q 完整退出新 Desktop；
7. 再次访问旧 3080 和旧 3091；
8. 再启动新 Desktop；
9. 确认只恢复新系统自己的状态。

预期：

- 两套系统同时可用；
- 无端口冲突；
- 无会话串线；
- 无 Key 串用；
- 无 Workspace 串用；
- 无 Profile 串用；
- 关闭任意一套不终止另一套。

### 13.5 空数据测试

清理或临时替换“新项目自己的”专用 DSH_HOME/userData 后启动。不能用 Desktop Reset 代替本测试，因为官方 Reset 主要重建 profiles/desktop，并不等于清空整套 Harness home 的 Session、settings、credentials 等产品数据。

预期：

- 显示全新安装状态；
- 不会回退读取 ~/.dsh；
- 不出现旧会话；
- 不出现旧头像、置顶、Persona；
- 不出现旧群聊；
- 不出现旧 Workspace；
- 需要重新配置新 Key。

不得为了这个测试移动、重命名或清理旧 ~/.dsh。

### 13.6 路径污染测试

在新仓库、lockfile、构建产物、运行日志和进程打开文件中搜索：

~~~text
deepseek-harness-entry
/2026-08-14/ya/deepseek-harness
/2026-08-14/ya/deepseek-harness-diy
~/.dsh/profiles/web
/Users/gene/.dsh
/Users/gene/.dsh/profiles/web
127.0.0.1:3080
127.0.0.1:3091
~~~

运行时代码和构建产物预期为零引用。

文档、SOURCE_IMPORT_MANIFEST 和只读来源说明中的旧路径可以例外；测试 fixture 中若故意验证拒绝旧路径，也必须清楚标注。运行时代码、lockfile、构建配置、Host 子进程和生成包不得依赖这些路径。

### 13.7 安全测试

确认：

- nodeIntegration=false；
- contextIsolation=true；
- sandbox=true；
- webSecurity=true；
- window.open 不被全局放开；
- 外部 URL 经过协议和 allowlist 校验；
- Renderer 无文件系统或任意 IPC 权限；
- LAN API 不能读取任意路径；
- 路径遍历被拒绝；
- 符号链接逃逸被拒绝；
- Key 仅可在受控凭据表单和提交请求内存中短暂存在，提交后清空；
- Key 不持久化到 Renderer storage、URL、日志、崩溃报告、群聊或 Git；
- LAN 用户不能查看或修改 Key；
- 群聊看不到未加入房间；
- 一个账号看不到另一个账号私人会话；
- 预览不暴露绝对路径；
- 敏感文件在落盘前拒绝；
- 附件下载要求鉴权。

### 13.8 旧生产无扰动测试

实施前后分别记录：

- 3080/3091/5226 监听；
- HTTP 健康状态；
- 旧插件 Git HEAD 和 status；
- 旧官方 checkout HEAD 和 status；
- Profile manifest 的只读摘要；
- 旧进程启动命令。

动态日志、在线人数和运行中群消息可能自然变化，不应误判；但不得出现由新项目造成的源码、依赖、配置或 lockfile 修改。

旧进程可能因用户操作、机器重启或自身故障独立变化。本任务不得主动 stop、kill、restart、升级或修复它们；若出现与本任务无关的旧系统故障，记录并通知用户，不要为了满足验收而擅自重启。验收关注新任务没有导致旧系统变化，不要求旧 PID 在整个长任务中绝对不变。

### 13.9 打包隔离与恢复测试

- 清除 shell DSH_HOME 后，通过 Finder、Dock 或 open 启动私有 App；
- 检查 Host 环境、日志和打开文件，确认使用私有 app-owned Harness home；
- 记录 app.getPath('userData')，确认是私有目录；
- 交叉启动官方 Desktop/私有 Desktop，验证 single-instance identity 不串线；
- 扫描 artifact，确认没有官方 download.deepseek.com Desktop update feed；
- 确认 updater 不自动调用官方检查；
- 执行官方 Reset/Repair 后，微信壳、群聊入口和内置 Host package 仍会恢复；
- 确认 Reset/Repair 没有链接旧插件路径；
- 如果缺少 macOS 签名/公证凭据，明确标记本节 artifact 项被阻塞，不把 dev:desktop 结果写成通过。

---

## 14. 验收标准

### 14.1 P0：必须满足

- 官方 Desktop Preview 在独立新项目中启动；
- 页面由 Electron Desktop 正常呈现；
- 核心使用 dsh-app:// 或执行时的官方 Desktop transport；
- 进程树中没有 dsh web，核心不提供 3080 式 Harness HTTP UI/API；开发模式预期的调试端口须实测仅绑定 loopback，用户显式启动的 Workspace 服务均可归因；
- 微信式主界面显示；
- 空白状态可以配置新 Key 和新 Workspace；
- 可以创建会话、发送、流式接收、停止和切换；
- 微信式群聊入口存在于 Desktop；
- 新 LAN 群聊可以独立启停；
- 新群聊不占用 3091；
- 新 Desktop 不依赖旧 3080/3091；
- 通过应用菜单 Quit 或 Cmd+Q 完整退出后，自己的 Host/sidecar 和群聊端口全部退出；
- 本任务没有主动停止、重启、升级或写入旧 3080/3091/5226；最终可测时记录旧服务状态。

### 14.2 P1：能力复用

- CAPABILITY_MATRIX.md 中所有 P1 项有明确结果；
- 不能实现的项有阻塞证据与替代方案；
- 没有用占位按钮冒充完成；
- 没有因为 API 变化静默删除能力；
- 官方已有更好实现的能力已优先复用；
- 关键微信交互与群聊能力有自动或人工测试证据。

### 14.3 隔离验收

- 独立 Git 项目；
- 独立 DSH_HOME；
- 独立 desktop Profile；
- 独立 Electron userData；
- 独立 app identity；
- 独立 Key；
- 独立 Workspace；
- 独立 Session；
- 独立 UI state；
- 独立 collaboration data；
- 独立端口；
- 新运行时不含旧绝对路径；
- 没有 link:/file: 指向旧项目；
- 没有读取旧 ~/.dsh；
- 没有触碰旧进程。
- 无 shell DSH_HOME 的 Finder/Dock 启动仍使用私有 Harness home；
- 运行时 userData、single-instance identity、credential service 和更新 feed 均与官方 Desktop/旧系统隔离。

### 14.4 Desktop 真实性验收

以下任意一种均不算完成：

- 只把 http://127.0.0.1 页面塞进 Electron；
- 依赖旧 3080 作为后端；
- 新开一个 dsh web 端口再套壳；
- 仅安装 Chrome PWA；
- 只运行微信 UI mock，没有真实 Harness；
- 只有 dev 页面可见，Host/Session 不工作；
- 只证明 dev:desktop 工作，却把自包含 runtime、打包 Profile、ASAR、原生模块或 updater 标成已通过；
- 通过关闭 Electron 安全策略获得“能打开”的假成功；
- 用旧 rc.2 runtime 作为隐藏兼容层。

真正完成应满足：

> 在不修改旧 3080/3091 的前提下，新 Desktop 能作为一套空白、独立的 Harness 使用；微信式普通会话与群聊入口都工作；两套可同时启动，并且没有数据、凭据、端口、依赖或生命周期耦合。若签名凭据尚未提供，必须诚实区分已完成的 dev 功能里程碑与尚未完成的自包含 artifact 验收。

### 14.5 七项硬门槛

1. **旧系统无扰动**：没有主动停止、重启、升级或写入旧服务、源码和 Profile。
2. **打包启动隔离**：无 shell DSH_HOME 的 Finder/Dock 启动仍使用独占 Harness home 和 userData；缺少签名凭据时明确标为未验收。
3. **真实 Desktop transport**：不存在 dsh web，不调用旧 3080/3091，本机业务走官方 Desktop Host/Connection/Remote。
4. **微信核心可用**：空白状态、新会话、流式消息、会话切换和微信式壳真实工作。
5. **群聊核心可用**：Desktop 内入口、新房间、LAN IP 加入、至少两个客户端、消息和使用新 Key/Workspace 的 AI 流程真实工作。
6. **生命周期独立**：Quit 新 Desktop 后其 Host、sidecar 和端口退出；旧系统没有被其生命周期控制。
7. **构建与更新隔离**：私有 app ID、无官方更新 feed、内置微信 package 不会被 Profile Reset/Repair 删除。

---

## 15. 风险清单

| 风险 | 严重度 | 处理原则 |
|---|---:|---|
| 旧 Client Runtime 已删除 | 高 | 按最新拆包 API 正式迁移，不带入 rc.2 runtime |
| APIProxy 已删除 | 高 | 改用 Remote Gateway/Session Controller |
| Desktop 禁用 Web Server | 高 | 内部能力走 Desktop transport，仅群聊用独立 sidecar |
| Desktop 不接受 link: 插件 | 高 | 作为私有 fork 内置 workspace package |
| 新版 V3 generation/事件可能令 rc.2 无法降级读取 | 高 | 使用完全独立 DSH_HOME，不共享产品状态或锁 |
| 新群聊误连旧 3091 | 高 | 新端口、实例 ID、数据目录和配置全部隔离 |
| Alpha 上游快速变化 | 高 | 开工固定 SHA，首版完成前不追 master |
| Electron 安全设置被临时关闭 | 高 | 设为硬门槛，不能以能运行替代安全迁移 |
| 旧工作树有 56 个未提交项 | 高 | 从实际工作树只读复制所需源码，不修改原目录 |
| 旧 localStorage 被误当资产迁移 | 中 | 只迁移功能和默认值，不迁移用户状态 |
| 插件隐含依赖第三方包 | 中 | 用能力矩阵识别，优先新版原生能力 |
| dev 模式成功、打包模式失败 | 中 | 有凭据时完成真实 artifact；无凭据时明确标记阻塞，不把 dev 结果冒充打包验收 |
| 新 app identity 与官方 Desktop 冲突 | 中 | 独立 productName、app ID、userData 和更新频道 |
| LAN sidecar 暴露 Host 权限 | 高 | 最小 API、服务端鉴权、Workspace 白名单和沙箱 |
| 硬编码旧端口/路径残留 | 高 | 路径污染测试和构建产物扫描 |
| macOS 签名/公证不可用 | 低于功能迁移 | 可完成 dev 功能里程碑；真实 artifact 验收标为受阻，或另建明确的 fork-only unsigned target |
| 私有 fork 误用官方更新源 | 高 | 代码和 builder 同时关闭官方 updater/feed，并扫描 artifact |
| Reset/Repair 删除微信核心 | 高 | 微信 bundle 进入固定 built-in composition，并测试恢复语义 |

---

## 16. 实施过程中禁止的捷径

- 不要更新 3080；
- 不要重启 3080/3091；
- 不要把旧项目复制后直接 npm update；
- 不要让新项目 link 到旧插件；
- 不要把旧 ~/.dsh 当测试数据；
- 不要复制旧 Key；
- 不要复制旧 Workspace；
- 不要复制旧 .collab-data；
- 不要复制旧浏览器 localStorage；
- 不要把新群聊绑在 3091；
- 不要让新 Desktop 请求 127.0.0.1:3080；
- 不要重启官方 Web Runtime 以恢复 ctx.webServer；
- 不要复制旧 client-runtime；
- 不要关闭 sandbox/contextIsolation/webSecurity；
- 不要无条件允许 window.open；
- 不要把私有插件发布到公共 npm；
- 不要让签名、公证阻塞前期功能开发，但也不要把未完成的 artifact 验收写成通过；
- 不要用 UI 截图或 mock 代替真实 Session 验收；
- 不要静默省略旧能力；
- 不要把旧项目文档中的历史授权当作本轮授权。

---

## 17. 建议的里程碑提交

建议至少形成以下可回退提交：

1. chore: pin upstream desktop preview baseline
2. docs: add isolation and capability matrix
3. chore: verify stock desktop development build
4. feat: add private wechat workspace packages
5. feat: render wechat shell with current desktop slots
6. feat: connect sessions and workspaces
7. feat: port message stream and attachments
8. feat: port desktop host services
9. feat: add isolated collaboration sidecar
10. feat: integrate group chat into desktop shell
11. test: add coexistence and isolation coverage
12. docs: add runbook, packaging and upstream rebase guide

每个里程碑后都应记录旧 3080/3091 的可测状态，并确认本任务没有主动修改或控制它们；若旧系统独立故障，通知用户而不是擅自修复。

---

## 18. 最终交付物

实施完成后至少交付：

- 独立的新 Desktop 项目；
- 固定 upstream SHA 和版本说明；
- 私有开发分支和清晰 commit 历史；
- 微信 UI Desktop 适配源码；
- Host 能力适配源码；
- 独立 LAN collaboration 实现；
- CAPABILITY_MATRIX.md；
- SOURCE_IMPORT_MANIFEST.md；
- ARCHITECTURE.md；
- ISOLATION.md；
- DEVELOPMENT.md；
- PACKAGING.md；
- TEST_REPORT.md；
- 已知问题和未实现项；
- 上游 rebase 指南；
- 新 Key、新 Workspace 和新群聊的配置说明；
- 双栈共存测试证据；
- 一份明确声明旧 3080 未被修改的最终报告。

最终报告必须列出：

- 实际采用的 upstream SHA；
- 实际 Desktop/dsh/Electron/开发 Node/打包资源 Node/pnpm 版本及 Host 启动方式；
- 新 DSH_HOME；
- 新 Electron userData；
- 新 app identity、single-instance identity 和 credential service；
- 新群聊端口；
- updater/feed 状态；
- Reset/Repair 验证结果；
- dev:desktop 与真实 artifact 分别完成了哪些验收；
- 新增或修改的 package；
- 完成的能力；
- 尚未完成的能力；
- 测试命令与结果；
- 打包状态；
- 签名/公证状态；
- 旧 3080/3091 的最终健康状态。

---

## 19. 推荐给下一位 Codex 的执行提示词

可以将本文直接附给下一位 Codex，并发送下面这段话：

> 请把所附的“DeepSeek Harness Desktop Preview 微信式双轨版迁移执行规格”作为本任务的权威范围说明。先完整阅读，再以只读方式核对现有 3080/3091 和旧 dsh-diy-lab；不要修改、升级、重启或停止旧系统。重新拉取执行时最新且可构建的官方 deepseek-ai/deepseek-harness Desktop Preview，按本文规则记录并固定 exact commit SHA，在全新的项目目录、DSH_HOME、Electron userData、Profile、Key、Workspace 和群聊数据中实施。目标不是迁移旧资产，而是将现有微信式 UI、普通会话能力和微信式 LAN 群聊能力适配到官方 Desktop 架构。新 Desktop 不得依赖 localhost Harness Web、旧 3080、旧 3091 或旧 rc.2 runtime。先建立带来源/证据级别的能力矩阵与原版 Desktop 基线，再分阶段完成 Renderer、Host、群聊 sidecar、隔离测试和双栈共存验收。请持续实施到 P0 完成；遇到当前官方 API 缺失时记录证据、替代方案和明确阻塞，不要静默删功能或用占位实现冒充完成。

---

## 20. 一句话完成定义

> 3080/3091 原样保留且不受新项目控制；另一个从空白开始的独立 DeepSeek Harness Desktop Preview 能在 Electron 中直接运行，使用自己的 Key、Workspace 和数据，同时复用微信式普通会话与微信式群聊能力；两套可同时启动，互不依赖、互不覆盖、互不干扰。
