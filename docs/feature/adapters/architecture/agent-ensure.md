# Agent Ensure —— 检查、缺失时安装、复检

「环境里应当有哪个 Agent」与「Agent 是否已经烘进环境」是两件事。
Adapter 在每次 `agent.setup` 里执行同一条 **Ensure 协议**:先检查 Agent 的可执行文件、精确版本与必要运行条件;检查通过就直接使用,检查不通过才执行锁定版本的安装,随后再检查一次。
官方 template、自建 template、任务镜像与空白环境都走这条协议,差别只是第一次检查是否命中——预装 Agent 是检查命中的优化,不是任意任务环境可运行的前提。

```text
sandbox case 物化 → 主 Sandbox
 → baseline → eval.setup
 → AgentProvisioner.ensure(sandbox)      # agent.setup 内
    ├─ check 通过  → 记录检查命中的安装事实
    └─ check 失败  → install → check
 → test(t) → scoring
```

Ensure 属于 Agent / Adapter,不属于 `Sandbox` 核心。
Sandbox 只提供执行命令、文件访问、默认用户与提权等已有能力;哪个命令代表 Codex 可用、应安装哪个版本,由 Codex Adapter 拥有。
Runner 只调用 Agent 生命周期,不出现 Agent 名分支。

## AgentProvisioner:三项义务

provisioner 承担三项义务,不建立跨 provider 安装步骤 DSL:

1. **锁定身份。**
   `identity` 是纯数据,至少含 Agent 名、精确版本与配方修订,进 configHash 与 `run.json`。
2. **题面外准备。**
   默认安装路径必须能在题面网络之外准备锁定制品(staged payload,见下节),再经主 Sandbox 文件通道送入。
3. **主 Sandbox 内 Ensure。**
   check → 缺失时 install → recheck,全部经主 Sandbox 的命令与文件 API 执行;安装只修改主 Sandbox,外层 DinD VM 与 sidecar 不安装 Agent、不向 Agent 暴露文件 API。

内置 Agent 带默认 provisioner,用户通常不写安装配置。
需要离线环境、内部镜像源或未内置 Agent 时整体替换:

```typescript
const internalCodex = defineAgentProvisioner({
  identity: {
    agent: "codex",
    version: "0.144.0",
    revision: "corp-2",
  },
  check: async (sandbox) => {
    const result = await sandbox.runCommand(["codex", "--version"]);
    const actualVersion = result.stdout.trim();
    return { ok: result.exitCode === 0 && actualVersion === "0.144.0", actualVersion };
  },
  install: async (sandbox) => {
    await sandbox.runCommand(
      ["/opt/company/install-codex", "0.144.0"],
      { root: true },
    );
  },
});

codexAgent({ provisioner: internalCodex });
```

`check` 返回结构化检查事实,不是 boolean:

```typescript
interface AgentCheckResult {
  ok: boolean;
  /** 实际探测到的版本;探测不到时省略,不编造。 */
  actualVersion?: string;
  /** ok 为 false 时的有界原因(缺命令 / 版本不匹配 / 运行条件缺失)。 */
  detail?: string;
}
```

「检查命中还是本次安装、实际是哪一版」要落 attempt 的安装事实;boolean 会逼 adapter 在旁边再探测一次同样的信息。

### 为什么是独立对象,不是 adapter 上的方法

- **identity / check / install 必须原子替换。**
  只换 install 不换 check 会让指纹与实际环境静默漂移;三样散布成 adapter 上的可覆盖方法时,类型系统拦不住半替换,打包成一个值则替换天然原子——「身份与检查同源」由结构保证,不靠纪律。
- **`prepare` 的节奏与 adapter 其余方法不同。**
  `SandboxAgentDef` 的 setup / send / teardown 全是 attempt 级、沙箱内;制品准备是 Run 级、宿主侧、以 identity 为 key 的 single-flight(与 `sandbox.build` 对称)。独立对象给协调器一个稳定的 single-flight 单位。
- **工厂参数是最小替换缝。**
  内置 adapter 的 def 由工厂产出、对用户不透明;方法长在 def 上,换安装逻辑就要展开重包整个 adapter,`codexAgent({ provisioner })` 一行替换、协议逻辑不碰。
- **Direct Agent 不背这些方法。**
  provisioner 只存在于 sandbox agent 的构造参数里,`Agent` 联合类型不为 direct 分支携带恒 undefined 的可选方法。

check 依赖的知识本来就属于 adapter——所以默认 provisioner 由 adapter 作者在工厂内部定义,对象只是让它可整体拔插。
Runner 侧不新增生命周期参与者:`ensure` 在 `agent.setup` 内由 adapter 自己执行,Runner 只额外消费 `identity`(进 configHash)与 `prepare`(Run 级协调)。
曾选方案与否决理由的存档见 [memory 条目](../../../../memory/agent-provisioner-object-not-adapter-methods.md)。

## Ensure 契约

- **检查精确身份。**
  `command -v` 只能证明「有一个同名命令」。
  检查至少覆盖可执行文件、解析后的精确版本与 Adapter 依赖的运行条件;结果写入 attempt 的安装事实,区分检查命中与本次安装。
- **不按 template 名短路。**
  官方 template 也必须检查——template 名、tag 或来源不是运行事实,被错误覆盖的官方 template 不能因为名字受信绕过验证。
- **安装必须收敛。**
  安装锁定精确 Agent 版本与配方修订;安装成功后重跑同一个检查。
  安装命令退出 0、检查仍失败时按环境错误处理,不把坏环境交给 Agent。
- **失败归环境准备。**
  检查、安装与复检都属于 `agent.setup`;失败得到 `errored`,附缺失命令、期望版本、实际版本与下一步,不记成 Agent 做题 `failed`。
- **不静默降级。**
  安装缺少 root、可写目录或前置运行时时点名缺项;内置 provisioner 不猜一个近似命令继续跑,也不在安装模式之间静默切换。

Node、npm prefix、包管理器与安装目录是具体 provisioner 的前置要求,不提升为所有 Sandbox 必须满足的系统级契约。
内置 Node Agent 优先使用运行用户拥有的安装目录,确需系统包才提权;检查以运行用户身份断言,不以 root 跑出假绿。

## 安装模式:三种,全部显式

| 模式 | 语义 | 谁声明 |
|---|---|---|
| `staged` | 内置默认路径:制品在题面网络之外准备,经文件 API 送入安装;题面网络不可用也能装 | 内置 provisioner 的默认值 |
| `sandbox-network` | 自定义 provisioner 显式声明用沙箱内网络与包管理器安装;网络可用性成为该 provisioner 的支持面 | 自定义 provisioner |
| `verifyOnly` | 只接受预装且检查命中的环境;检查失败立即 `errored`,不联网、不修改文件系统 | 不可变、离线或审计环境的用户 |

失败后不允许在三种模式之间静默猜测或降级;换模式是配置变更,不是运行时回退。

## staged payload:题面网络之外的锁定制品

内置 coding Agent 的默认安装路径按以下契约准备制品:

- 目标 platform / libc 从**主 Sandbox** 探测(`uname -s` / `uname -m` / `ldd`),不是宿主平台:
  制品要装进沙箱,macOS 宿主起 linux 容器是常态,按宿主取会准备出跑不了的二进制。
  调用方可用 `EnsureAgentOptions.platform` 显式锁定。
- 以 Agent identity + 目标 platform / libc 为 key,在 Run 级经宿主网络、provider control plane 或随 niceeval npm 包分发的制品取得一次;single-flight,多个 attempt 共享。
- 校验 digest 后进入本地 / 远端共享 cache;解析后的制品 digest 与平台进入 configHash 和 `run.json`。
- 准备时间记为 Run 级开放 activity `agent.artifact.prepare`(落盘形状见 [Record · 两层时间模型](../../record/architecture.md#两层时间模型生命周期锚点与开放-activity)),不占 attempt 并发位。
- 安装时经主 Sandbox 的文件 API 上传已准备 payload;**payload 优先自带 Agent 所需运行时**。
  任务镜像由题目决定,不能假设它带 Node / Python 工具链——内置 Node CLI Agent 因此优先取该平台的
  自带运行时原生包(如 `@openai/codex@<ver>-linux-arm64` 里的 musl 静态二进制),安装退化成
  「解压 + 链接」,沙箱里只需要 `tar`。某个平台只有依赖运行时的包时,provisioner 必须在安装前
  检查该前置条件并点名缺项(`agent.ensure.npmMissingInSandbox`),不猜一个近似命令继续跑。
- 安装不得要求修复题面 DNS、代理、`extra_hosts` 或 egress;题面的网络配置在 Agent 进场前逐字保持。

### 故意断网的题面

坏网络本身可以是题目:`dns: 192.0.2.1`、错误 `extra_hosts`、被替换的 `curl` / `apt` 都是待修故障,不是环境缺陷。
这类题面的 Ensure 义务:

- provider 与 provisioner 不改坏 DNS、不恢复被替换的系统工具;Agent 安装检查通过后,题面网络仍保持故障。
- 默认内置 Agent 用 staged payload 完成安装,不依赖题面网络;删除 staged 路径后这类题必须失败在 `agent.setup`,这是用例区分力的验收判据。
- Agent 完成任务后,verifier 才观察网络是否由 Agent 修好。

## 身份、指纹与可比性

attempt 环境身份由两根正交的轴组成:

```text
attempt 环境身份
 = provider sandbox case 身份(CaseKey 等,见 Sandbox Case)
 + AgentProvisioner.identity(+ staged payload 的制品 digest 与平台)
 + 其它解析后配置
```

改任务 Dockerfile 只重建环境、不动 Agent 配置;改 Agent 版本只改变 Ensure identity 与制品 activity,不重建任务 BuildKey。
两种变化都触发重跑,但不强制发布二者笛卡尔积的预制产物——同一份任务构建产物可以被多个 Agent experiment 消费,每个 Agent 在主 Sandbox 内自行检查或安装。

检查得到的实际版本作为运行事实落盘(attempt `facts` 的 `agent.ensure` / `agent.version.actual` 键),用于核对声明身份是否兑现;它不能反过来替代规划期指纹。
没有精确版本的 `latest` 安装不参与可携带结果:内置 provisioner 不提供这条模式,自定义 provisioner 无法给出稳定身份时启动期报错。

## 构建期与运行时的关系

构建脚本与运行时安装可以使用各自原生工具,共享的是同一个 `identity` 与同一个 `check`:

- 官方产物可以继续由 provider 原生构建脚本预装 Agent,发布前执行 provisioner 的检查。
- 项目自建 template 只装任务依赖也合法;运行时 Ensure 负责补 Agent。
- provider 可以维护带 Agent identity 的派生 cache 作为检查命中优化;未命中时回到任务环境产物后装 Agent。
- 构建命令与运行时命令不强求逐字符同源;漂移由发布门与运行时复检发现。

## Sandbox 复用与 environment 隔离

Runner 按现有契约每 attempt 调 Agent `setup`,Ensure 自身必须可收敛:复用沙箱第一次安装后,后续 attempt 的检查快速命中。
安装产物放在 workdir 外的 Agent 自有目录,题间 reset 不删除;Agent 配置与任务 workspace 仍逐 attempt 重建。

不同 environment profile 不共享 Sandbox,也不共享安装产物。
同一 experiment 同时运行多个环境时,一条重环境 eval 装过的 Agent 不会让另一条环境错误继承它;安装事实与指纹不串组。

## 相关阅读

- [Agent 数据契约](agent-contract.md) —— `send`、AgentContext 与配置归属不变量。
- [Sandbox Agent](../library/sandbox-agent.md) —— `setup` / `send` / `teardown` 的编写指南。
- [Sandbox Case](../../sandbox/case.md) —— 主 Sandbox 从哪里来、BuildKey / CaseKey 是什么。
- [Record · 两层时间模型](../../record/architecture.md#两层时间模型生命周期锚点与开放-activity) —— `agent.artifact.prepare` 与错误归属的落盘形状。
- [Experiments · 缓存与携带](../../experiments/cache.md) —— identity 与制品 digest 怎样进入指纹。
