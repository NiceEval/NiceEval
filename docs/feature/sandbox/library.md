# Sandbox ——库用法

`t.sandbox`(eval 作者)与 Eval / Experiment 的 `sandbox` layer 声明(选起点与 Provider)是这个功能的两个入口。
声明面的完整契约见 [Sandbox Layer](layers.md);本篇讲运行中的 Sandbox 怎么调用,内部怎么实现见 [Architecture](architecture.md)。

## 路径与 workdir:一个坐标系

每个 provider 的 agent 默认工作目录不同——这是**provider 的知识,不是 eval 作者的负担**:

| provider | workdir |
| --- | --- |
| docker | `/home/sandbox/workspace` |
| E2B | `/home/user/workspace` |
| Vercel Sandbox | `/vercel/sandbox` |
| local | 你指定的目录(默认当前 git 仓库根,见[本地执行](local.md)) |

契约一句话:**API 里任何沙箱侧相对路径,一律解析到 `workdir`;省略的 `targetDir` / `cwd` 默认就是 `workdir`;绝对路径原样使用。
** 本地侧(宿主机)的相对路径则解析到 eval 定义文件所在目录。
两侧各只有一个锚点,学一次就够。

为什么 workdir 是唯一正确的默认值:整条流水线都锚定在它上面——变更分类账以它为 work-tree、agent 的 cwd 在那里、send 窗口的改动在那里折叠成 agent diff、`t.sandbox.fileChanged(...)` 的路径也是对着那里解析的。
把起始文件传到任何**别的**目录,agent 看不见它,diff 也采不到它,整条 eval 静默失效。
所以对上传起始 workspace 这个最高频调用来说,workdir 不是"常见选择",是唯一能让系统其余部分正常工作的选择——一个参数如果 99% 的调用只有一个正确值,而调用者又不掌握这个值(它随 provider 变),强制填写就不是"显式更安全",是逼人抄错答案。

workdir 里只有两类写入者:你(fixture、校验材料、环境层 Hook)和 agent。
runner 自己的运行时数据一律在 workdir 外:变更分类账在沙箱内的私有路径,行为摘要根本不进沙箱、在宿主侧现算 ([Observability · 宿主侧行为断言](../../observability.md#宿主侧行为断言to11y))。
因此 fixture 初始化可以假设 workdir 初态为空:只要你自己的环境层 Hook 没先写过文件, `git clone <url> .` 这类要求空目录的命令能直接落在 workdir 根。

### 用户会怎么写:before / after

没有这个坐标系时,用户被迫自己拼两侧的绝对路径:

```typescript
// ❌ before:用户要背下 docker 的路径,还要用 import.meta.url 拼本地绝对路径
const WORKSPACE = new URL("../workspaces/ts-starter/", import.meta.url).pathname;

export default defineEval({
  description: "实现 Button 组件",
  async test(t) {
    await t.sandbox.uploadDirectory(WORKSPACE, "/home/sandbox/workspace"); // ← docker 专属,切 e2b 即坏
    await t.send("在 src/components/Button.tsx 实现 Button,接受 label 和 onClick。");
    const test = await t.sandbox.runCommand("npm", ["test"], { cwd: "/home/sandbox/workspace" });
    t.check(test, commandSucceeded());
    t.sandbox.fileChanged("src/components/Button.tsx");
  },
});
```

有坐标系后,同一条 eval:

```typescript
// ✅ after:全程零绝对路径,换 dockerImageSandbox() / e2bSandbox() / vercelSandbox() 零改动切换
export default defineEval({
  description: "实现 Button 组件",
  async test(t) {
    await t.sandbox.uploadDirectory("../workspaces/ts-starter"); // 本地相对 eval 文件;远端默认 workdir
    await t.send("在 src/components/Button.tsx 实现 Button,接受 label 和 onClick。");
    const test = await t.sandbox.runCommand("npm", ["test"]);    // cwd 默认 workdir
    t.check(test, commandSucceeded());
    t.sandbox.fileChanged("src/components/Button.tsx");          // diff 路径本来就是 workdir 相对
  },
});
```

消掉的东西:`import.meta.url` 拼路径的咒语、两处 hardcode 的 provider 专属绝对路径,以及"切换 provider 文件落到 agent 视野之外"这个静默 bug 的整个物种。
用户对"文件在哪"的心智模型收敛成一句话:**一切相对路径都在 workspace 里**——和 git 的 repo 相对路径同构,不需要关心物理位置。

### 逃生舱:`sandbox.workdir`

绝对路径不会彻底消失,三种场景会穿透坐标系:往 prompt 里告诉 agent 一个路径、对照 agent 日志/工具输出里出现的绝对路径、`docker exec` 进容器手动调试。
这时用 `workdir` 属性,不要背表:

```typescript
await t.send(`参考 ${t.sandbox.workdir}/docs/CONVENTIONS.md 里的约定实现组件。`);
```

注意 `$HOME` 这类环境变量不是替代品:`targetDir` 是宿主侧 JS 里拼的字符串,shell 变量根本不展开——`uploadDirectory(dir, "$HOME/workspace")` 会真的创建一个叫 `$HOME` 的目录。
运行时 `runShell("pwd")` 探测也不必要:workdir 是 provider 构造时就确定的静态字符串,声明就能解决的问题不用运行时手段。

### 为什么不伪造一个统一的 `/workspace`

另一条路是让所有 provider 都真的提供 `/workspace`(mkdir + symlink 到真实 workdir)。
不走这条:`/workspace` 不是 agent 实际的 cwd,agent 的日志、工具输出、报错里出现的全是真实路径,伪造的统一路径会让用户在对照时更糊涂;云 provider(vercel/e2b)对用户目录之外的文件系统权限也未必允许。
这与「用户与 root」一节是同一处理哲学:**语义跨 provider 一致(相对路径→workdir),物理值诚实暴露差异(`workdir` 属性)**,不假装统一。

实现细节(路径解析规则收敛在哪个文件、一份实现如何跨 provider 共用)见 [Architecture · 实现纪律](architecture.md#实现纪律)。

## 用户与 root

**默认非 root,按需提 root** ——命令默认以沙箱的标准**非 root** 用户跑(agent 的自然环境:安全,且 Claude Code 等在 root 下会拒绝 `--dangerously-skip-permissions`)。
需要 root 的准备命令(安装系统依赖:`apt-get install …`、`pip install --break-system-packages …`)给 `runCommand` 传 `{ root: true }`。

```typescript
// eval setup:只有装系统依赖这步提 root;其余(含 agent、验证)默认非 root。
await sandbox.runCommand("apt-get", ["install", "-y", "openjdk-17-jdk"], { root: true });
await sandbox.runCommand("npm", ["install"]);   // 默认非 root,cwd 默认 workdir
```

**这套语义跨 provider 一致**,且与主流沙箱服务同构 ——三个内置 provider 各自把 `{ root: true }` 映射到自己的原生机制:

| provider | 默认用户 | `{ root: true }` 映射 |
| --- | --- | --- |
| docker | `node`(UID 1000) | `exec --user root` |
| E2B | 非 root(`user`) | `commands.run(cmd, { user: "root" })` |
| Vercel Sandbox | 非 root(`vercel-sandbox`) | `runCommand(cmd, { sudo: true })` |
| local | 宿主当前用户 | 不支持,报错(niceeval 不在你的机器上提权,见[本地执行](local.md)) |

约定:**默认值(非 root)与 `root` 的语义在所有 provider 保持一致**,不因 provider 而变——自定义 provider(`defineSandbox()`)接哪个服务都照这条约定映射到该服务的原生机制。
本就全程 root 的服务把提 root 视作 no-op;完全无法提 root 的服务可不支持(抛错)——但这是"不支持",不是"语义不同"。
eval 因此不必感知底下是哪个 provider。

## 命令上限:`timeout`

`runCommand` / `runShell` 的 options 收一个 `timeout`(毫秒),给这一条命令自己的上限。
**省略是常态**:省略时上限就是 attempt deadline 的剩余量,provider 层没有独立默认。
显式传一个更短的值是有意声明,照常生效;撞线时归属记成命令显式 `timeout`。
完整规则见 [Architecture · 时限归属](architecture.md#时限归属attempt-deadline-是唯一默认)。

```typescript
await sandbox.runShell("pnpm build");                  // 上限 = deadline 剩余量
await sandbox.runCommand("pnpm", ["test"], { timeoutMs: 60_000 }); // 这条最多 60 秒
```

## Provider 选择:template 带出,没有默认值

Provider 由 template-bearing factory 原子带出:factory 声明完整起点,同时选定兑现它的 Provider,**不接受未包装字符串,也不会自动探测环境替你选一个**。
对 Sandbox Agent,每个实际选中的 Eval × Experiment 配对必须恰好一方带 template;没有游离的 Provider 配置、项目级默认值,也没有 `--sandbox <name>` 这种 CLI 覆盖。
两方都带 template 报 `sandbox.template-conflict`,两方都没有报 `sandbox.template-missing`;错误在创建任何资源前全矩阵聚合。
这条对 [`localSandbox()`](local.md) 尤其硬:在宿主机上直接跑 agent 生成的命令是有后果的,绝不因缺配置替你悄悄落到本地档。
配对规则、factory 目录与错误反馈的完整契约见 [Sandbox Layer](layers.md#每个配对的-link-约束)。

```typescript
import { defineExperiment } from "niceeval";
import { e2bSandbox } from "niceeval/sandbox";
import { claudeCodeAgent } from "niceeval/adapter";

export default defineExperiment({
  agent: claudeCodeAgent(),
  sandbox: e2bSandbox({ template: "niceeval-agents" }),
});
```

多个 Experiment 共享同一起点时,把 factory 调用抽成普通 TypeScript helper 导出；Sandbox 设计不提供 profile registry 或按名字查表。

## 起点参数与 `lifetimeMs`

provider 名只是个字符串,带不了参数,也没法表达"哪个是镜像、哪个是沙箱 Run ID"。
和 [agent](../adapters/README.md) 一样,起点用**数据结构**定义:factory(从 `niceeval/sandbox` 导出)产出 template-bearing layer,放进 Eval 或 Experiment 的 `sandbox` 字段。

```typescript
import {
  dockerComposeSandbox,
  dockerfileSandbox,
  dockerImageSandbox,
  e2bSandbox,
  localSandbox,
  vercelSandbox,
} from "niceeval/sandbox";

dockerImageSandbox({ image: "niceeval-agents:node24" })  // Docker:从 image 起
dockerfileSandbox({ context: new URL(".", import.meta.url) })  // Docker:按 Dockerfile 构建
dockerComposeSandbox({                                   // Docker Compose:完整资源组
  file: new URL("docker-compose.yaml", import.meta.url),
  workspaceService: "client",
})
e2bSandbox({ template: "niceeval-agents" })              // E2B:指定模板
vercelSandbox({ snapshotId: "snap_xxx" })                // Vercel:从 snapshot 起
localSandbox()                                           // 宿主机本地目录(默认当前 git 仓库根,见 local.md)
```

云 Provider 和 Docker 还接受 `lifetimeMs`，它声明一个 Sandbox 最长需要存活多久：

```typescript
e2bSandbox({
  template: "niceeval-agents",
  lifetimeMs: 4 * 60 * 60_000,
})
```

`lifetimeMs` 属于 Sandbox Provider 配置，与 Experiment `timeoutMs` 不同。
前者控制一个 Sandbox 的生命周期，后者限制一条 Attempt；复用时 Runner 还会在派发前确认现有 Sandbox 能否覆盖下一条 Attempt。

对 E2B，带 deadline 的 Attempt 在未声明 `lifetimeMs` 时会请求 `timeoutMs + 30s` 收尾预留，不能退回 SDK 的短默认值。声明了 `lifetimeMs` 时它必须不少于同一最低值；不足会在创建实例前报错，NiceEval 不会静默把作者声明加长。未声明 Attempt deadline 时没有可推导的有限寿命；需要该保证就显式声明 `lifetimeMs`。
完整规则见 [Sandbox 复用](reuse.md#两种时间不能混用)。

起点参数只在对应 Provider 内部消费——**核心不按 provider 名分支**,Runner 只消费 factory 归一出的 template 与 Provider planner。

参数的典型用途是**预制环境**:把 agent CLI 烘焙进镜像/模板,让后续 eval 跳过安装直接开跑。

### 可发布预制环境

稳定、体积大、每个 attempt 都相同的内容(系统包、agent CLI、编译好的二进制、模型 cache、固定工具链)应在跑 eval 之前做进 provider 的可发布产物,attempt 从产物起实例:Docker 的 image、E2B 的 template、Vercel 的 snapshot。
构建归 provider 原生工具,NiceEval 只消费 factory 参数里的产物 ID;layer 的 `prepare()` 只处理必须按 experiment / eval 变化的小配置、真实检查和 fail-fast 预检。

各 provider 的构建工作流、官方 coding agent 起点、自己写预制环境的 DX、新 provider 的义务与运行时 checkpoint,见 [预制环境](library/prebuilt-environments.md)。

## 准备命令:layer 的 `prepare()`

跑 agent 前的环境准备写成 layer 的 `prepare()` 命令,每条 Attempt 都执行。
声明形状、command identity 与 cleanup 契约见 [Sandbox Layer](layers.md);执行时序见 [三方准备时序](lifecycle.md)。

这一层解决的是一类特定问题:**环境内容必须按实验或题目变化,不能在构建期固定**。
稳定的大依赖先做进 image / template / snapshot;prepare 是运行时的薄层,昂贵动作靠真实检查快速命中,不是每 Attempt 重装工具链和下载大模型的默认位置。

```typescript
export default defineExperiment({
  agent: codexAgent({ mcpServers: [mempalMcp] }),
  sandbox: e2bSandbox({ template: "fasteval-agents-mempal" }) // 二进制和模型 cache 已预制
    .prepare(installTool({                                    // 真实检查,缺失才装,装后复检
      tool: "mempal",
      identity: { version: "0.9.0" },
      probe: shell("mempal --version | grep -q 0.9.0"),
      install: shell("curl -fsSL https://get.mempal.dev | sh"),
    }))
    .setup(restoreMempalForThisPhysicalSandbox)
    .teardown(archiveMempalFromThisPhysicalSandbox),
  sandboxReuse: true,
  maxConcurrency: 1,                                          // 只维持一个连续的物理实例
});
```

这是一个真实的 downstream 场景:记忆条件测试里,MCP server(构造期配置,决定"有没有这个工具")走 `codexAgent({ mcpServers: [...] })`;环境层(这次实验要不要装某个二进制、预热)走 layer 的 `prepare()`。
两条职责线不混:MCP/skills/model 依旧只从 adapter factory 进,prepare command 不复制 factory 拥有的配置知识,见 [Adapter · 配置归属不变量](../adapters/architecture/agent-contract.md#配置归属不变量)。

跨 Attempt 的沙箱内状态不写进 prepare command，也不放进 Experiment 顶层字段。把它挂在现代 `SandboxLayer` 的 `.setup()` / `.teardown()`：前者在物理实例创建后一次运行，后者在 provider stop 前一次运行；`sandboxReuse: true` 时正好覆盖同一台被复用物理实例的首尾，需要固定顺序再声明 `maxConcurrency: 1`。

prepare 抛错按执行错误计(`verdict: "errored"`,基建问题,不是 agent 做题失败),归属 `sandbox.prepare.<owner>`。
清理经 `context.onCleanup()` 在取得资源后就地登记,按全局准备顺序逆序执行;未执行或取得失败的命令不产生虚假 cleanup。
收尾链上的每个可调用体各自有 30s 清理超时,到点按 teardown 失败处理(`teardown-failed` 诊断)并继续走下一段——收尾不能无限拖住退出(整体设计见 [CLI 内部架构 · 中断:三级响应](../../cli.md#中断三级响应))。

Direct Agent(`kind: "direct"`)没有真实 Sandbox。
任一侧为它声明 SandboxLayer 都是 `sandbox.unexpected-for-direct-agent`,在创建资源前报错,不静默忽略。

## 向运行反馈进度、诊断与事实

provider 创建和 prepare command 都可以向当前 `niceeval exp` 报告信息,但 runner 为它们绑定不同的 lifecycle scope:

```typescript
const layer = e2bSandbox({ template: "niceeval-agents" })
  .prepare(async (sandbox, context) => {
    context.progress({ message: "checking project helper", current: 1, total: 2 });
    await ensureProjectHelper(sandbox);

    context.progress({ message: "warming project build cache", current: 2, total: 2 });
    try {
      await warmProjectBuildCache(sandbox);
    } catch (error) {
      context.diagnostic({
        code: "project-build-cache-degraded",
        level: "warning",
        message: "Build-cache warm-up failed; continuing without the warm cache",
        data: { reason: String(error) },
      });
    }
  });
```

三条通道语义互斥,调用方只能把一次观测归入其中一类:

- `progress` 是当前 prepare 的短期状态,例如正在检查、下载或预热;它不进入最终结果。
- `diagnostic` 是真实异常、退化或需要处理的问题,会进入永久输出。
  正常容量、缓存大小、版本和命中状态本身是中性观测,不能无条件伪装成 warning。
  只有达到明确且可解释的风险条件时才上报 diagnostic。
- `facts` 是中性运行观测,例如本次实际使用的版本、缓存大小和命中状态;它进入结果供事后审计,不参与 fingerprint。

反馈通道不能指定 phase——runner 从当前 command 的 owner 自动得出阶段。
反馈也不替代控制流:上例明确选择降级继续;如果环境或当前操作无法继续,应直接抛出原错误,让 Attempt 进入 `errored`。

`context.facts(key, value)` 上报运行环境观测。
它落进本 Attempt 的 `result.json`(`AttemptRecord.facts`),在 show 的 `facts:` 行、对照矩阵与 `--json` 中作为一等观测量呈现。
计划内自变量必须同时进入 `flags`、model、agent、sandbox 配置等 fingerprint 输入；无法配置化的外部可变状态变化后用 `--rerun all` 重跑。
key/value 形状、覆盖与复用边界见 [Results · facts](../record/architecture.md#facts运行事实):

```typescript
context.facts("build-cache.bytes", cacheBytes);
context.facts("build-cache.hit", cacheHit);
```

自定义 provider 在 `create` options 上取得绑定到 `sandbox.create` 的 `feedback`:

```typescript
import { Effect } from "effect";
import { CustomSandboxMaterializationError, defineSandbox } from "niceeval/sandbox";

export default defineSandbox({
  name: "modal",
  targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
  create: ({ deadline, runtime, feedback }) => Effect.tryPromise({
    try: async () => {
      feedback.progress({ message: "allocating Modal sandbox" });
      const instance = await allocateModal({ deadline, runtime });
      if (instance.usedFallbackRegion) {
        feedback.diagnostic({
          code: "modal-fallback-region",
          level: "warning",
          message: `Using fallback region ${instance.region}`,
          data: { region: instance.region },
        });
      }
      return new MyModalSandbox(instance);
    },
    catch: (cause) => new CustomSandboxMaterializationError({
      code: "modal-allocation-failed",
      message: "Modal sandbox allocation failed",
      cause: cause instanceof Error ? cause : new Error(String(cause)),
    }),
  }),
});
```

provider 的 retry/backoff 与 SDK 原始日志也走这条反馈管线,不能直接写 `stdout` / `stderr`;这样 Human dashboard 不会被打散,CI 事件也能保持单一顺序。
完整 API 与其它入口的对应关系见 [Experiments · 生命周期代码怎样向这次运行反馈](../experiments/library.md#生命周期代码怎样向这次运行反馈)。

## 环境预置放哪

要在跑 agent 前准备环境,按职责分摊到下面几处——**每一处都是普通代码,不是框架编排**:

| 要准备的东西 | 放哪 | 怎么清理 |
|---|---|---|
| 所有 attempt 都相同的重依赖(系统包、CLI、二进制、大模型 cache) | provider 原生 image/template/snapshot 构建脚本;template factory 只引用产物 | provider 的 image/template/snapshot 生命周期管理 |
| **这个实验**整场一份、宿主机侧的共享服务(隧道、每实验专用 mock server、license 租约) | [`ExperimentDefinition.setup`](../experiments/library.md#实验级共享服务setup-与-teardown):整场一次,第一个要派发的 attempt 前跑 | `ExperimentDefinition.teardown`,全部 attempt 收尾后执行(中断也执行;setup 时点走到过才触发) |
| **这次实验**才知道的沙箱内环境(工具检查与安装、小配置、预检) | Experiment layer 的 [`prepare()`](layers.md):每 Attempt 执行,昂贵动作靠真实检查快速命中 | `context.onCleanup()` 就地登记,逆序执行;沙箱内文件随销毁自动没了 |
| **这条 eval** 的题目准备(checkout、依赖)与任务 Fixture | Eval layer 的 [`prepare()`](layers.md),或 `test(t)` 里的普通代码(`t.sandbox.writeText` / `writeBytes` / `runCommand`) | 随沙箱销毁或题间 reset;要清沙箱外的东西用 `context.onCleanup()` / `try/finally` |
| Agent CLI 的精确版本(每 Attempt probe) | Adapter 必填 `ensure` + identity 匹配的 [`AgentInstaller`](../adapters/architecture/agent-ensure.md)；Runner 负责 probe、缺失时安装、复检 | 安装失败归 `agent.ensure`；产物随 Sandbox 销毁或题间复用策略处理 |
| 连 agent、写鉴权、主配置与扩展(每 Attempt 一次) | [`SandboxAgent.setup`](../adapters/architecture/agent-contract.md#生命周期不变量)；要读写 Agent 安装产物的后置脚本走 factory 的 [`postSetup`](../adapters/library/coding-agent-extensions.md#安装后运行脚本postsetup) | 随 Sandbox 销毁；要收尾的动作挂成对的 `preTeardown`，逆序且先于 Agent teardown |
| 跨 Attempt 的沙箱内状态(记忆库、累积笔记) | modern `SandboxLayer.setup()` / `.teardown()`；setup 接收 `(sandbox, { experimentId, signal, progress, diagnostic, fact })` | teardown 在 Agent teardown 与 Attempt cleanup 后、provider stop 前逆序运行；`maxConcurrency: 1` 只保证本 Invocation 串行，多个 Invocation 共用 checkpoint 时还要声明 Experiment `sharedState.key` |
| **跨实验共享**、这次 run 之前就该存在的外部服务(共享 DB、公司内网服务本体) | 外部编排:`docker compose up -d && niceeval exp … && docker compose down`,或 CI 脚本 | 外部编排负责,URL 经 env 传入 agent / eval |

分工只看两个维度——**随什么变化**(实验 / eval / 都不随)与**活在哪一侧**(宿主机 / 沙箱内):宿主机侧、每实验一份的服务进 `ExperimentDefinition.setup`;沙箱内、按实验变的环境(装什么、开不开预热)进 Experiment layer;题目材料按 eval 变(这条题目需要哪些起始文件)进 Eval layer 或 `test(t)`;agent 怎么连自己是 agent 的私事;跨实验、生命周期长于一次 run 的资源交给外部编排。

## 自定义 provider:`defineSandbox`

只在自己项目里用、不打算贡献回 niceeval 时,用 `defineSandbox`(`niceeval/sandbox` 导出)——传 `create()` 直接产出一个实现 `Sandbox` 接口的实例。
它构成一个自定义 template-bearing layer;身份、能力与留存义务见 [Sandbox Case · 自定义 case](case.md#自定义-case):

```typescript
import { Effect } from "effect";
import { CustomSandboxMaterializationError, defineSandbox } from "niceeval/sandbox";

export default defineSandbox({
  name: "modal",                          // 只用于展示 / 日志,不参与分发
  targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
  recommendedConcurrency: 8,               // 可选;省略默认 5
  create: ({ deadline, runtime, feedback }) => Effect.try({
    try: () => {
      feedback.progress({ message: "allocating Modal sandbox" });
      // 返回一个实现 Sandbox 接口(run/read/write/stop/...)的实例
      return new MyModalSandbox({ deadline, runtime });
    },
    catch: (cause) => new CustomSandboxMaterializationError({
      code: "modal-allocation-failed",
      message: "Modal sandbox allocation failed",
      cause: cause instanceof Error ? cause : new Error(String(cause)),
    }),
  }),
});
```

`create` 返回 typed `Effect`，不是 Promise。
provider 的分配失败必须进入 Effect error channel。
资源成功创建后由 NiceEval 的 Scope 接管。
Scope release 统一执行 stop 或已经提交的 keep disposition。

自定义 provider 不支持 `--keep-sandbox`。
留存后的 `niceeval sandbox stop` 是不加载 config / eval 模块的新进程,无法安全找回用户对象上的销毁函数;框架也不会用“删登记项、让用户手工清理”冒充完整生命周期。
组合使用会在调用 `create()` 前报错,不会先起一个无法纳管的实例。

要贡献进 niceeval 本体(像 docker/vercel/e2b 那样内置)走另一条路,见 [Architecture · 再接一个 provider](architecture.md#再接一个-provider)。

## 相关阅读

- [README](README.md) ——为什么需要沙箱、provider 统一接口。
- [Sandbox Layer](layers.md) —— `sandbox` 声明:template 配对、准备命令与顺序。
- [三方准备时序](lifecycle.md) —— link 规划、owner 顺序与 fresh / reuse 次数。
- [预制环境](library/prebuilt-environments.md) ——各 provider 的构建工作流、官方 agent 起点与运行时 checkpoint。
- [CLI](cli.md) —— `--keep-sandbox` 留存现场与 `niceeval sandbox` 清理命令。
- [操作 Sandbox](library/operations.md) —— `t.sandbox` 的文件与命令 API。
- [断言 Sandbox 结果](library/asserting-results.md) —— diff、文件和 shell 行为怎么评分。
- [Architecture](architecture.md) —— provider 内部实现、生命周期时序、性能与重试。
