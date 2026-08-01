# Agent Ensure —— probe、缺失才 install、复检

「环境里应当有哪个 Agent」与「怎么把它装进环境」是两件事。
前者是 Adapter 的 ensure 声明(`AgentEnsure`:目标 identity 加只读 probe);后者是按 identity 配对的官方 Agent 安装层(`AgentInstaller`)。

Runner 在每条 Attempt 的 `agent.ensure` 相位执行 **ensure 循环**:probe 命中就直接使用,未命中时由配对安装层执行锁定版本的安装,随后复检同一个 probe。
`agent.ensure` 排在两方作者 layer 的 prepare command 之后、State load 之前;Agent runtime setup 仍记 `agent.setup`。
官方 template、自建 template、任务镜像与空白环境都走这条循环,差别只是第一次 probe 是否命中——预装 Agent 是 probe 命中的优化,不是任意任务环境可运行的前提。

```text
sandbox case 构建所需产物并启动实例 → 主 Sandbox
 → 每条 Attempt:reset → template owner 命令 → 另一作者 owner 命令
 → agent.ensure:逐条 ensure 声明执行循环
    ├─ probe 命中   → 记录命中的安装事实
    └─ probe 未命中 → 按 identity 配对安装层 → install → 复检 probe
 → State load → workspace baseline → Agent runtime setup(agent.setup)
 → test(t) → scoring
```

probe 是只读探测零件,install 是安装零件,ensure 是「probe → 缺失才 install → 复检」的循环;`installTool` 是它的工具版,`agent.ensure` 是 Agent 版(词族与 `installTool` 见[内置 prepare 命令](../../sandbox/prepare-commands.md))。
ensure 声明属于 Agent / Adapter,安装属于 Agent 安装层,两者都不属于 `Sandbox` 核心。
Sandbox 只提供执行命令、文件访问、默认用户与提权等已有能力;哪条命令证明 Codex 可用、应安装哪个版本,由 Codex Adapter 与它的配对安装层拥有。
Runner 只组装并执行循环,不出现 Agent 名分支。

## ensure 声明:Adapter 在 Sandbox 内的全部准备义务

```typescript
interface AgentEnsure {
  /** 目标身份:纯数据,至少含 Agent 名与精确版本;与配对安装层的版本常量同源。 */
  readonly identity: SerializableValue;
  /** 只读探测:退出码零=命中,非零=未命中(不是失败)。 */
  readonly probe: StableSandboxCommand;
}

interface SandboxAgentDef {
  /** 必填;数组按声明顺序执行。 */
  readonly ensure: AgentEnsure | readonly AgentEnsure[];
  // send、runtime setup / teardown 与事件协议见 Sandbox Agent 与 Agent 数据契约
}
```

- **probe 用普通 `runCommand` 语义执行,零副作用。**
  `command -v` 只能证明「有一个同名命令」;probe 至少覆盖可执行文件、精确版本与 Adapter 依赖的运行条件。
- **identity 是纯数据。**
  Agent 名、精确版本与 revision 连同精确匹配的 installer identity/revision/installMode 按声明顺序进入
  configHash 与 `run.json`;它同时是配对安装层的选择键。installer 分发内容变化必须显式提升 revision。
- **Adapter 在 Sandbox 内的准备义务只有这份声明。**
  安装步骤、staged payload 与平台探测都在安装层;凭据与鉴权归 runtime `setup`(记 `agent.setup`)。

内置 Agent 的 ensure 声明由 adapter 工厂内部给出,用户不写安装配置。
第三方 adapter 可以只写协议加 ensure 声明(纯适配),也可以随包导出自己的安装层;两条路径的差别只在 probe 未命中时有没有配对安装层接手:

```typescript
export default defineSandboxAgent({
  name: "my-coding-agent",
  evidenceCoverage: completeEvidenceCoverage,
  ensure: {
    identity: { agent: "my-coding-agent", version: "1.4.2" },
    probe: shell('test "$(my-agent --version)" = "1.4.2"'),
  },
  async send(input, ctx) {
    // 纯协议适配:驱动 CLI、归一事件
  },
});
```

## Agent 安装层:AgentInstaller

```typescript
interface AgentInstallerBase {
  /** 与某条 AgentEnsure.identity 精确匹配;版本常量与该声明同源。 */
  readonly identity: SerializableValue;
  /** 支持的目标平台;不支持的平台在安装前报错点名,不猜近似路径。 */
  readonly platforms?: readonly string[];
}

type AgentInstaller =
  | (AgentInstallerBase & {
      readonly installMode: "staged";
      prepareArtifact(context: AgentArtifactContext): MaybePromise<PreparedAgentPayload>;
      install(sandbox: SandboxCommandTarget, context: StagedAgentInstallContext): Promise<void>;
    })
  | (AgentInstallerBase & {
      readonly installMode: "sandbox-network";
      readonly prepareArtifact?: never;
      install(sandbox: SandboxCommandTarget, context: AgentInstallContext): Promise<void>;
    })
  | (AgentInstallerBase & {
      readonly installMode: "verify-only";
      readonly prepareArtifact?: never;
      readonly install?: never;
    });

interface AgentArtifactContext {
  readonly targetPlatform: string;
  readonly signal: AbortSignal;
}

interface PreparedAgentPayload {
  readonly content: RegisteredSandboxContent;
  readonly digest: string;
  readonly targetPlatform: string;
}

interface AgentInstallContext {
  readonly identity: SerializableValue;
  readonly targetPlatform: string;
  readonly signal: AbortSignal;
  readonly progress: (update: { readonly message: string }) => void;
}

interface StagedAgentInstallContext extends AgentInstallContext {
  readonly artifact: PreparedAgentPayload;
}
```

安装层拥有 staged payload、安装模式与 payload 校验;目标平台由 pair 的 `ProviderPlan` 在创建前确定。
凭据与鉴权始终归 Adapter 的 runtime `setup`,不进安装层。
`install` 全部经主 Sandbox 的命令与文件 API 执行;安装只修改主 Sandbox,外层 DinD VM 与 sidecar 不安装 Agent、不向 Agent 暴露文件 API。

官方内置 adapter 出厂自带配对安装层:同一个包发布,identity 里的版本常量同源,与预制环境「命中预装与回退安装装同一版」是同一条规则。
identity 对不上时没有配对安装层,probe 未命中的失败大声报出,不静默换一版安装。

## agent.ensure 相位:Runner 组装的循环

Adapter 声明 ensure,Runner 由 ensure 声明与配对安装层组装 Agent layer;组装没有公开 API,Adapter 与作者都不手工排列安装组件。
Agent layer 仍是 command-only、永远排在两方作者 layer 之后、不能带 template;排序与 template 禁令见 [Sandbox · Agent layer](../../sandbox/layers.md#agent-layer)。
作者面零变化:安装随 experiment 选择的 agent 自动接线,Eval / Experiment 作者不 import 任何安装对象。

每条 `AgentEnsure` 按声明顺序走同一条循环:

1. probe 用 `runCommand` 执行；退出码零命中，非零是正常未命中，记录命中的安装事实。
2. 未命中时按 identity 精确匹配 `AgentInstaller`：`staged` 先执行宿主侧 `prepareArtifact()` 再在主 Sandbox `install()`；`sandbox-network` 直接 `install()`；`verify-only` 不安装并立即报缺失。安装后复检同一个 probe。
3. install 失败或复检仍未命中:Attempt `errored`,归 `agent.ensure`,附 identity、期望版本与下一步,不记成 Agent 做题 `failed`。
4. probe 未命中且没有 identity 匹配的安装层:同样 `errored`,错误信息给两条出路——换预装该版本的预制环境让 probe 命中,或作者在 Experiment layer 用 [`installTool`](../../sandbox/prepare-commands.md) 自装。

离线环境与内部镜像源走同样的两条出路:预装进预制环境,或用 `installTool` 按内部渠道安装;ensure 循环只认 probe 的运行事实,不问安装出自哪条渠道。

### 为什么拆成声明与安装两半

- **协议与安装的变化轴不同。**
  协议随 CLI 的输出方言与会话机制变,安装随分发渠道、平台矩阵与镜像源变。
  拆开后,第三方接入一个新 CLI 只需要协议加 probe,不背 staged payload 与平台矩阵;安装实现升级也不触碰协议代码。
- **原子性由 identity 精确配对保证。**
  probe 与 install 各自锁定版本时,防漂移的结构是同源版本常量加精确配对:安装层按 ensure 声明的 identity 被选中,改版本只改一处常量,两半同时变。
  identity 对不上时循环拿不到安装层,失败带着两边 identity 的对比大声报出,不会静默装出另一版。
- **`prepareArtifact` 的节奏与 adapter 其余方法不同。**
  `SandboxAgentDef` 的 setup / send / teardown 全是 attempt 级、沙箱内。
  staged payload 准备是 Run 级、宿主侧、以 identity 为 key 的 single-flight(与 `sandbox.build` 对称)。
  安装层给协调器一个稳定的 single-flight 单位。
- **Direct Agent 不背安装。**
  ensure 只存在于 `SandboxAgentDef`,`Agent` 联合类型不为 direct 分支携带恒 undefined 的字段。

裁决与曾选方案见 [memory 条目](../../../../memory/pure-adapter-official-installer.md)。

## Ensure 契约

- **probe 检查精确身份。**
  probe 至少覆盖可执行文件、精确版本与 Adapter 依赖的运行条件;命中还是本次安装写入 attempt 的安装事实。
- **不按 template 名短路。**
  官方 template 也必须 probe——template 名、tag 或来源不是运行事实,被错误覆盖的官方 template 不能因为名字受信绕过验证。
- **安装必须收敛。**
  安装锁定精确 Agent 版本;安装成功后重跑同一个 probe。
  install 退出 0、复检仍未命中时按环境错误处理,不把坏环境交给 Agent。
- **失败归环境准备。**
  probe 配对、install 与复检都属于 `agent.ensure`;失败得到 `errored`,附缺失命令、期望版本与下一步,不记成 Agent 做题 `failed`。
- **不静默降级。**
  安装缺少 root、可写目录或前置运行时时点名缺项;内置安装层不猜一个近似命令继续跑,也不在安装模式之间静默切换。

Node、npm prefix、包管理器与安装目录是具体安装层的前置要求,不提升为所有 Sandbox 必须满足的系统级契约。
内置 Node Agent 优先使用运行用户拥有的安装目录,确需系统包才提权;probe 以运行用户身份断言,不以 root 跑出假绿。

## 安装模式:三种,全部显式

| 模式 | 语义 | 谁声明 |
|---|---|---|
| `staged` | 内置默认路径:staged payload 在题面网络之外准备,经文件 API 送入安装;题面网络不可用也能装 | 内置安装层的默认值 |
| `sandbox-network` | 安装层显式声明用沙箱内网络与包管理器安装;网络可用性成为该安装层的支持面 | 自定义安装层 |
| `verify-only` | 只接受预装且 probe 命中的环境;probe 未命中立即 `errored`,不联网、不修改文件系统 | 不可变、离线或审计环境的用户 |

失败后不允许在三种模式之间静默猜测或降级;换模式是配置变更,不是运行时回退。

## staged payload:题面网络之外的锁定安装文件

内置 coding Agent 的默认安装路径由安装层的 `prepareArtifact()` 按以下契约准备 staged payload:

- 目标 platform / libc 来自**每个 Eval pair 的 ProviderPlan**，不是宿主平台，也不是创建后才临时决定:
  同一个 Experiment 可以选择目标平台不同的 Eval，staged payload 因此按计划目标分桶。
- 主 Sandbox 创建后仍执行 `uname -s` / `uname -m` / `ldd`，但它只验证实际平台与计划目标完全一致；
  不一致立即以环境错误终止，绝不拿实际结果改写计划或换另一份 staged payload。
- prepare key 由 ensure identity、installer revision 与计划目标 platform / libc 组成。
  Run 级只取得一次安装文件，多个同目标 attempt 通过 single-flight 共享。
- 校验 digest 后进入本地 / 远端共享 cache。实际 artifact digest 与实际平台只作为 runtime provenance/facts 落盘，
  不进入 configHash 或 fingerprint；可比性由 installer 静态 revision 与 ProviderPlan target 分别承担。
- 准备时间记为 Run 级开放 activity `agent.artifact.prepare`(落盘形状见 [Record · 两层时间模型](../../record/architecture.md#两层时间模型生命周期锚点与开放-activity)),不占 attempt 并发位。
- 安装时经主 Sandbox 的文件 API 上传已准备 payload;**payload 优先自带 Agent 所需运行时**。
  任务镜像由题目决定,不能假设它带 Node / Python 工具链——内置 Node CLI Agent 因此优先取该平台的
  自带运行时原生包(如 `@openai/codex@<ver>-linux-arm64` 里的 musl 静态二进制),安装退化成
  「解压 + 链接」,沙箱里只需要 `tar`。某个平台只有依赖运行时的包时,安装层必须在安装前
  检查该前置条件并点名缺项(`agent.ensure.npmMissingInSandbox`),不猜一个近似命令继续跑。
- 安装不得要求修复题面 DNS、代理、`extra_hosts` 或 egress;题面的网络配置在 Agent 进场前逐字保持。

### 故意断网的题面

坏网络本身可以是题目:`dns: 192.0.2.1`、错误 `extra_hosts`、被替换的 `curl` / `apt` 都是待修故障,不是环境缺陷。
这类题面的 Ensure 义务:

- provider 与安装层不改坏 DNS、不恢复被替换的系统工具;Agent 安装复检通过后,题面网络仍保持故障。
- 默认内置 Agent 用 staged payload 完成安装,不依赖题面网络;删除 staged 路径后这类题必须失败在 `agent.ensure`,这是用例区分力的验收判据。
- Agent 完成任务后,verifier 才观察网络是否由 Agent 修好。

## 身份、指纹与可比性

attempt 环境身份由两根正交的轴组成:

```text
attempt 环境身份
 = pair-owned ProviderPlan 身份(含计划 target platform/libc)
 + Agent ensure 静态身份(ensure identity、精确配对的 installer identity/revision 与安装模式)
 + 其它解析后配置
```

Agent ensure 静态身份进入 configHash；pair-owned ProviderPlan 进入逐 Eval fingerprint 与 Sandbox 复用池键，完整输入清单见[三方准备时序](../../sandbox/lifecycle.md#身份与复用池)。
改任务 Dockerfile 只重建环境、不动 Agent 配置;改 Agent 版本只改变 ensure identity 与 staged payload activity,不重建任务 BuildKey。
两种变化都触发重跑,但不强制发布二者笛卡尔积的预制产物——同一份任务构建产物可以被多个 Agent experiment 消费,每个 Agent 在主 Sandbox 内自行 probe 或安装。

probe 命中还是本次安装作为运行事实落盘(attempt `facts` 的 `agent.ensure` 键),用于核对声明身份是否兑现;运行事实不能反过来替代规划期指纹。
没有精确版本的 `latest` 安装不参与可携带结果:内置安装层不提供这条模式,ensure 声明无法给出稳定 identity 时启动期报错。

## 构建期与运行时的关系

构建脚本与运行时安装可以使用各自原生工具,共享的是同一个 `identity` 与同一个 `probe`:

- 官方产物可以继续由 provider 原生构建脚本预装 Agent,发布前执行同一个 probe。
- 项目自建 template 只装任务依赖也合法;运行时的 ensure 循环负责补 Agent。
- provider 可以维护带 Agent identity 的派生 cache 作为 probe 命中优化;未命中时回到任务环境产物后装 Agent。
- 构建命令与运行时命令不强求逐字符同源;漂移由发布门与运行时复检发现。

## Sandbox 复用与复用池隔离

ensure 循环每条 Attempt 都执行且必须可收敛:复用 Sandbox 第一次安装后,后续 attempt 的 probe 快速命中。
安装产物放在 workdir 外的 Agent 自有目录,题间 reset 不删除;Agent 配置与任务 workspace 仍逐 attempt 重建。

复用池键固定为 `(CaseKey, templateOwner, author layer identities, Agent ensure identity)`,见[三方准备时序](../../sandbox/lifecycle.md#身份与复用池)。
键不同的窗口不共享 Sandbox,也不共享安装产物:一条重环境 eval 装过的 Agent 不会让另一条错误继承它;安装事实与指纹不串组。

## 相关阅读

- [Agent 数据契约](agent-contract.md) —— `send`、AgentContext 与配置归属不变量。
- [Sandbox Agent](../library/sandbox-agent.md) —— `setup` / `send` / `teardown` 的编写指南。
- [内置 prepare 命令](../../sandbox/prepare-commands.md) —— probe / install / ensure 词族与 `installTool`。
- [Sandbox Case](../../sandbox/case.md) —— 主 Sandbox 从哪里来、BuildKey / CaseKey 是什么。
- [Record · 两层时间模型](../../record/architecture.md#两层时间模型生命周期锚点与开放-activity) —— `agent.artifact.prepare` 与错误归属的落盘形状。
- [Experiments · 缓存与携带](../../experiments/cache.md) —— installer 静态 identity/revision 与 ProviderPlan target 怎样进入两层身份，runtime digest 为什么不进入。
