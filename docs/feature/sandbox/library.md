# Sandbox ——库用法

`t.sandbox`(eval 作者)与 Eval / Experiment 的 `sandbox` layer 声明(选起点与 Provider)是这个功能的两个入口。
声明面的完整契约见 [Sandbox Layer](layers.md);本篇讲运行中的 Sandbox 怎么调用,内部怎么实现见 [Architecture](architecture.md)。

## 路径与 workdir:一个坐标系

每个 provider 的 agent 默认工作目录不同——这是**provider 的知识,不是 eval 作者的负担**:

| provider | workdir |
| --- | --- |
| docker | `/home/sandbox/workspace` |
| incus | `/home/sandbox/workspace` |
| E2B | `/home/user/workspace` |
| Vercel Sandbox | `/vercel/sandbox` |

契约一句话:**API 里任何沙箱侧相对路径,一律定位到 `workdir`;省略的 `targetDir` / `cwd` 默认就是 `workdir`;绝对路径原样使用。
** 本地侧(宿主机)的相对路径则定位到 eval 定义文件所在目录。
两侧各只有一个起点,学一次就够。

为什么 workdir 是唯一正确的默认值:整条流水线都锚定在它上面——变更分类账以它为 work-tree、agent 的 cwd 在那里、send 区间的改动在那里折叠成 agent diff、`t.sandbox.fileChanged(...)` 的路径也是对着那里定位的。
把起始文件传到任何**别的**目录,agent 看不见它,diff 也采不到它,整条 eval 静默失效。
所以对上传起始 workspace 这个最高频调用来说,workdir 不是"常见选择",是唯一能让系统其余部分正常工作的选择——一个参数如果 99% 的调用只有一个正确值,而调用者又不掌握这个值(它随 provider 变),强制填写就不是"显式更安全",是逼人抄错答案。

workdir 里只有两类写入者:你(fixture、校验材料、layer Hook)和 agent。
runner 自己的运行时数据一律在 workdir 外:变更分类账在沙箱内的私有路径,行为摘要根本不进沙箱、在宿主侧现算 ([Observability · 宿主侧行为断言](../../observability.md#宿主侧行为断言to11y))。
因此 fixture 初始化可以假设 workdir 初态为空:只要你自己的 layer Hook 没先写过文件, `git clone <url> .` 这类要求空目录的命令能直接落在 workdir 根。

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
// ✅ after:全程零绝对路径,换 dockerSandbox() / e2bSandbox() / vercelSandbox() 零改动切换
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

注意 `$HOME` 这类 shell 变量不是替代品:`targetDir` 是宿主侧 JS 里拼的字符串,shell 变量根本不展开——`uploadDirectory(dir, "$HOME/workspace")` 会真的创建一个叫 `$HOME` 的目录。
运行时 `runShell("pwd")` 探测也不必要:workdir 是 provider 构造时就确定的静态字符串,声明就能解决的问题不用运行时手段。

### 为什么不伪造一个统一的 `/workspace`

另一条路是让所有 provider 都真的提供 `/workspace`(mkdir + symlink 到真实 workdir)。
不走这条:`/workspace` 不是 agent 实际的 cwd,agent 的日志、工具输出、报错里出现的全是真实路径,伪造的统一路径会让用户在对照时更糊涂;云 provider(vercel/e2b)对用户目录之外的文件系统权限也未必允许。
这与「执行身份」一节是同一处理哲学:**语义跨 provider 一致(相对路径→workdir),物理值诚实暴露差异(`workdir` 属性)**,不假装统一。

实现细节(路径定位规则收敛在哪个文件、一份实现如何跨 provider 共用)见 [Architecture · 实现纪律](architecture.md#实现纪律)。

## 执行身份

**默认沿用起点声明的身份** ——命令与 agent 以起点声明的用户跑:Docker 镜像的 `USER`(未声明时按 Docker 语义是 root)、Compose service 的 `user:` 或其镜像的 `USER`、E2B template 的默认用户。
起点由题目作者写:Dockerfile 里的 `USER` 就是题目对执行身份的声明。
runner 静默换用户不产生任何报错,只表现为一片 `Permission denied`,所以 NiceEval 不替换起点声明的身份。

要别的身份,用两个显式入口,粒度不同:

- **起点替换**:template factory 传 `user`,整个 Sandbox 的默认身份换成它(agent 也以它跑),值进入 fingerprint。
- **单条命令替换**:`runCommand` / `runShell` 传 `{ user: "root" }`,只这一条命令换身份。

```typescript
// 起点:镜像未声明 USER(默认 root),显式让 agent 以非 root 跑
sandbox: dockerSandbox({ source: { type: "image", image: "node:24-slim" }, user: "node" }),

// 命令:只有装系统依赖这步提 root;其余(含 agent、验证)保持 Sandbox 默认身份
await sandbox.runCommand("apt-get", ["install", "-y", "openjdk-17-jdk"], { user: "root" });
await sandbox.runCommand("npm", ["install"]);   // 默认身份,cwd 默认 workdir
```

**这套语义跨 provider 一致**——各 provider 把 `user` 映射到自己的原生机制:

| provider | 省略时的默认身份 | `user` 映射 |
| --- | --- | --- |
| docker(image / Dockerfile / Compose) | 镜像 `USER` 或 Compose service `user:`;未声明按 Docker 语义是 root | factory 与命令都支持任意用户(`exec --user`) |
| incus | `node` uid 1000 | factory 不收 `user`；命令级 `{ user }` 映射 guest `exec --user` |
| E2B | template 的默认用户(`user`) | factory 与命令都支持(`commands.run` 的同名参数) |
| Vercel Sandbox | `vercel-sandbox` | 只支持命令级 `{ user: "root" }`(映射 `sudo: true`);其它值报错,factory 不收 `user` |

**非 root 是预制实例的义务,不是 runner 的强加。**
Claude Code 等 agent 在 root 下拒绝 `--dangerously-skip-permissions`,所以官方 coding agent 镜像与模板都自带非 root 用户并在配方里声明(见[预制实例](library/prebuilt-environments.md));自己写预制实例时同样在 Dockerfile / template 里声明 `USER`。
把安全默认放进可发布的构建结果,身份对 `docker run` 一类原生工具同样可见;藏在 runner 运行时里的换用户对谁都不可见。

约定:**省略(起点默认)与 `user` 的语义在所有 provider 保持一致**,不因 provider 而变——自定义 provider(`defineSandbox()`)接哪个服务都照这条约定映射到该服务的原生机制。
本就全程 root 的服务把 `{ user: "root" }` 视作 no-op;完全无法换身份的服务可不支持(抛错)——但这是"不支持",不是"语义不同"。
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

## PATH:受管变量与 pathPrepend

`PATH` 由 Sandbox 计算并维护(npm 全局安装目录、系统默认路径……),不接受经 `runCommand` / `runShell` 的 `env` 改写——这条契约对所有内置 provider 一致。
Adapter 声明的进程变量(如 [Codex CLI 的 `env`](../adapters/sdk/codex-cli/README.md))若含 `PATH` 键,在 `codexAgent()` 调用时同步报错,不留到 setup 才发现值被静默丢弃。

需要扩展 PATH(装了私有工具链、要把它排在 agent 找到的可执行文件前面),用 Sandbox factory 的 `pathPrepend`:

```typescript
sandbox: dockerSandbox({ source: { type: "image", image: "niceeval-agents:node24" },
  pathPrepend: ["/opt/toolchain/bin"], // 排在受管 PATH 最前面
}),
```

语义:

- 按声明顺序前置到受管 PATH，作用于该 Sandbox 内全部受管命令：Agent 进程、各 owner 的 before、`agent.ensure` 的探测/install/复检。callback 与子进程经这些命令继承，不需要另外声明。
- 属于 Sandbox 配置,进 template identity;改值会让携带的历史结果失效,与改 `image` / `user` 同一类。
  **省略与显式传空数组是同一份 identity**(absent ≡ default):身份序列化只在非空时带上这个键,作者不声明 `pathPrepend` 和显式写 `pathPrepend: []` 不会因为写法不同分裂出两份 digest。
  这是可选配置字段的通用规则,不是 `pathPrepend` 专属。任何新增的可选 factory 字段,值等于默认值时都不进身份序列化,只有偏离默认值才计入摘要;`pathPrepend` 是这条规则唯一落地的字段。
- 各内置 provider(docker / e2b / vercel)一致支持;`defineSandbox` 自定义 provider 里,PATH 完全是 `create()` 返回的实例自己的事,niceeval 不替它管。

```typescript
e2bSandbox({ template: "niceeval-agents", pathPrepend: ["/opt/toolchain/bin"] })
vercelSandbox({ snapshotId: "snap_xxx", pathPrepend: ["/opt/toolchain/bin"] })
```

## Provider 选择:template 带出,没有默认值

Provider 由 template-bearing factory 原子带出:factory 声明完整起点,同时选定兑现它的 Provider,**不接受未包装字符串,也不会自动探测替你选一个**。

对 Sandbox Agent,每个实际选中的 Eval × Experiment 配对必须恰好一方带 template;没有游离的 Provider 配置、项目级默认值,也没有 `--sandbox <name>` 这种 CLI 替换。
两方都带 template 报 `sandbox.template-conflict`,两方都没有报 `sandbox.template-missing`;错误在创建任何资源前全矩阵聚合。
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

多个 Experiment 共享同一起点时,把 factory 调用抽成普通 TypeScript 导出函数；Sandbox 设计不提供 profile registry 或按名字查表。

## Setup prefix cache 配置

Setup prefix cache 是 Host 执行优化。项目级 `niceeval.config.ts` 提供默认值，Experiment 可以替换本次运行声明：

```typescript
interface Config {
  readonly sandboxCache?: {
    readonly setup?: "use" | "bypass";
  };
  /** 同一 Run 内 PreparedArtifact 前缀节点可同时准备的最大数；省略为 2。 */
  readonly maxSetupPrefixConcurrency?: number;
}

interface ExperimentDefinition {
  readonly sandboxCache?: {
    readonly setup?: "use" | "bypass";
  };
}

export default defineConfig({
  sandboxCache: { setup: "use" },
});
```

省略 `sandboxCache` 或 `setup` 时默认 `use`。项目 Config 提供持久默认；Experiment 可以替换自己的运行声明。该字段不出现在 Eval 或 Eval Group，因为同一个 Experiment 内的全部 Attempt 必须使用同一策略。固定优先级是 `--sandbox-setup-cache` → `defineExperiment().sandboxCache.setup` → `defineConfig().sandboxCache.setup` → `"use"`。

`bypass` 禁止 SetupPrefix lookup 与 publication，但仍按同一 DAG 真实执行 before action。BuildKey cache 仍正常使用。该选择不进入 BuildKey、SetupPrefixKey、CaseKey、Attempt fingerprint、result identity 或携带资格；同一声明只因 cache 冷热或排障开关不同，结果仍可比较。

`niceeval debug` 会显示求值后的 `setupCache: use | bypass`，但仍固定显示 `cacheLookup: "not-probed"`。运行时 bypass 使用 `replay` 反馈并带 `reason: "bypass"`。

`maxSetupPrefixConcurrency` 只限制一个 Run 中 `PreparedArtifact` 前缀 DAG 的同时 prepare 节点数；它必须是正整数，省略为 `2`。`niceeval exp` 的 `--max-setup-prefix-concurrency <n>` 只临时替代本次 Invocation 的该值。它既不改变 `SetupPrefixKey`、BuildKey、CaseKey、Attempt/result identity，也不替代 `maxConcurrency`：前者限制派发前的共享准备，后者限制已派发的 Attempt。实际同时 prepare 数还受 provider `scheduling.lane.limit` 约束，取两者交集。

## 起点参数与 `lifetimeMs`

provider 名只是个字符串,带不了参数,也没法表达"哪个是镜像、哪个是沙箱 Run ID"。
和 [agent](../adapters/README.md) 一样,起点用**数据结构**定义:factory(从 `niceeval/sandbox` 导出)产出 template-bearing layer,放进 Eval 或 Experiment 的 `sandbox` 字段。

```typescript
import {
  dockerComposeSandbox,
  dockerSandbox,
  e2bSandbox,
  incusSandbox,
  sandboxLayer,
  vercelSandbox,
} from "niceeval/sandbox";

dockerSandbox({ source: { type: "image", image: "niceeval-agents:node24" } })
dockerSandbox({ source: { type: "dockerfile", context: new URL(".", import.meta.url) } })
dockerComposeSandbox({                                   // Docker Compose:完整资源组
  file: new URL("docker-compose.yaml", import.meta.url),
  workspaceService: "client",
})
e2bSandbox({ template: "niceeval-agents" })              // E2B:指定模板
vercelSandbox({ snapshotId: "snap_xxx" })                // Vercel:从 snapshot 起
incusSandbox({                                           // Experiment:一次性 Incus VM
  image: "niceeval/docker-execution-v1@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  project: "niceeval-eval",
  storagePool: "niceeval-evals",
})
sandboxLayer({                                           // Eval:nested Docker requirement
  requirements: {
    nestedDocker: {
      compose: "v2",
      minimumDataBytes: 4 * 1024 ** 3,
    },
  },
})
```

云 Provider 和 Docker 还接受 `lifetimeMs`，它声明一个 Sandbox 最长需要存活多久：

```typescript
e2bSandbox({
  template: "niceeval-agents",
  lifetimeMs: 4 * 60 * 60_000,
})
```

`lifetimeMs` 属于 Sandbox Provider 配置，与 Experiment `timeoutMs` 不同。
前者控制一个 Sandbox 的生命周期，后者限制一条 Attempt；复用时 Runner 还会在派发前确认现有 Sandbox 能否承接下一条 Attempt。

对 E2B，带 deadline 的 Attempt 在未声明 `lifetimeMs` 时会请求 `timeoutMs + 30s` 收尾预留，不能退回 SDK 的短默认值。声明了 `lifetimeMs` 时它必须不少于同一最低值；不足会在创建实例前报错，NiceEval 不会静默把作者声明加长。未声明 Attempt deadline 时没有可推导的有限寿命；需要该保证就显式声明 `lifetimeMs`。
完整规则见 [Sandbox 复用](reuse.md#两种时间不能混用)。

起点参数只在对应 Provider 内部消费——**核心不按 provider 名分支**,Runner 只消费 factory 归一出的 template 与 Provider planner。

参数的典型用途是**预制实例**:把 agent CLI 烘焙进镜像/模板,让后续 eval 跳过安装直接开跑。

### Nested Docker：Incus 推荐路径

普通 `dockerSandbox({ source })` 继续提供 Docker image / Dockerfile 单容器执行；它适合 Agent 不需要控制另一层 Docker daemon 的任务。

Agent 要在 Sandbox 内运行 Docker 或 Compose 时，Eval 用
`sandboxLayer({ requirements: { nestedDocker } })` 声明 provider-neutral 的 Nested Docker、Compose 与最低 data capacity。
`docker/v1`、sandbox-private daemon 与专用 kernel 是这项要求的固定语义。

Experiment 用 `incusSandbox()` 选择 Host 管理的 Incus project、storage pool 与 digest-pinned trusted image。
完整公开形状、资源字段、capability receipt 与错误码见 [Nested Docker Library](nested-docker/library.md)。

Incus 为每条 Attempt 创建一次性 VM。guest 内运行普通 dockerd，Docker data 使用与 root / workspace 分开的私有 virtual disk；`resources.cpus`、`memoryBytes` 与 `dockerDataBytes` 进入 identity 和容量检查。SetupPrefix 复用完整、可验证的 immutable Provider artifact，每个 consumer clone 私有 writable root / data disk。

raw privileged / managed rootless DinD、privileged outer container、inner daemon data-root clone / capture 均不属于支持目标，也不能在 Incus planning 失败时作为 fallback。宿主 Docker socket不能满足 `dedicated-kernel/v1`；可信本地工具若需要该能力，必须另立 capability 与 trust boundary。普通 Docker provider 本身不受这项迁移影响。

Incus guest 的 `otlpHost` 为 `null`。Runner 在 Sandbox 内启动 attempt-scope OTLP receiver，Agent 只访问 `127.0.0.1`。作者已经提供受控 tunnel / 可达路由时，可用 `defineConfig({ telemetry: { host } })` 显式改走宿主 receiver。

### 可发布预制实例

稳定、体积大、每个 attempt 都相同的内容(系统包、agent CLI、编译好的二进制、模型 cache、固定工具链)应在跑 eval 之前做进 provider 的可发布构建结果。

Attempt 直接使用 Docker image、E2B template、Vercel snapshot，或 Incus 的 digest-pinned trusted base 与 immutable prepared artifact 作为起点。

构建归 provider 原生工具,NiceEval 只消费 factory 参数里的构建结果 ID。

layer 的 `before()` 只处理必须按 Experiment / Eval Group / Eval / Agent 变化的小配置、真实检查和 fail-fast 预检。

各 provider 的构建工作流、官方 coding agent 起点、自己写预制实例的 DX、新 provider 的义务与运行时 checkpoint,见 [预制实例](library/prebuilt-environments.md)。

## Owner 包裹：layer 的 `before()` / `after()`

跑 Agent 前的预置写成 layer 的 `before()` action。planning 根据 typed inputs 编译 attempt occurrence。缓存命中 restore verified state,不调用 action；physical promotion 属于后续性能工作。
声明形状、command identity 与 cleanup 契约见 [Sandbox Layer](layers.md);执行时序见 [三方准备时序](lifecycle.md)。

这一层解决的是一类特定问题:**Sandbox 内容必须按实验或题目变化,不能在构建期固定**。
稳定的大依赖先做进 image / template / snapshot;before 是运行时的薄层,昂贵动作可以命中准备前缀,不是每 Attempt 重装工具链和下载大模型的默认位置。

Action 默认声明 `cache.state = sandboxState.all`，表示命中必须恢复它的全部可观察副作用。nested Docker 不提供 `sandboxState.dockerData` 特殊缓存；Incus Provider 只对完整、可验证的 prepared Sandbox artifact 报告 coverage，每个 Attempt 从 artifact clone 私有 writable state。

```typescript
export default defineExperiment({
  agent: codexAgent({ mcpServers: [mempalMcp] }),
  sandbox: e2bSandbox({ template: "fasteval-agents-mempal" }) // 二进制和模型 cache 已预制
    .before(shell({                                          // 单个声明式 Action
      id: "install-mempal",
      command: "mempal --version | grep -q '^0.9.0$' || (npm install -g mempal@0.9.0 && mempal --version | grep -q '^0.9.0$')",
      changeFrequency: changeFrequency.rare,
    }))
    .before(async (sandbox, context) => {
      const checkpoint = await restoreMempalForThisPhysicalSandbox(sandbox);
      context.onCleanup(() =>
        archiveMempalFromThisPhysicalSandbox(sandbox, checkpoint),
      );
    }),
  sandboxReuse: true,
  maxConcurrency: 1,                                          // 只维持一个连续的物理实例
});
```

这是一个真实的 downstream 场景。记忆条件测试里的 MCP server 是构造期配置,决定“有没有这个工具”,走 `codexAgent({ mcpServers: [...] })`。按实验变化的安装内容决定这次是否安装二进制或预热,走 Experiment layer 的 `before()`。
两条职责线不混:MCP/skills/model 依旧只从 adapter factory 进,before action 不复制 factory 拥有的配置知识,见 [Adapter · 配置归属不变量](../adapters/architecture/agent-contract.md#配置归属不变量)。

跨 Attempt 的外部状态不放进可缓存 before，也不放进 Experiment 顶层字段。用 callback before 恢复状态，成功后立即通过 `context.onCleanup()` 登记本条 Attempt 的回存；callback 是 opaque barrier，不会提升为 physical-instance occurrence。

`sandboxReuse: true` 时，动态 cleanup 承接同一台被复用物理实例的收尾。需要固定共享状态顺序时再声明 `maxConcurrency: 1`。

before 抛错按执行错误计(`verdict: "errored"`,基建问题,不是 agent 做题失败),归属 `sandbox.before.<owner>`。
cleanup 经 `context.onCleanup()` 在取得资源后就地登记，只按实际登记栈 LIFO 执行；未执行或取得失败的命令不产生虚假 cleanup。
收尾链上的每个可调用体各自有 30s cleanup 超时,到点按 teardown 失败处理(`teardown-failed` 诊断)并继续走下一段——收尾不能无限拖住退出(整体设计见 [CLI 内部架构 · 中断:三级响应](../../cli.md#中断三级响应))。

Direct Agent(`kind: "direct"`)没有真实 Sandbox。
任一侧为它声明 SandboxLayer 都是 `sandbox.unexpected-for-direct-agent`,在创建资源前报错,不静默忽略。

## 向运行反馈进度、诊断与事实

provider 创建和 before action 都可以向当前 `niceeval exp` 报告信息,但 runner 为它们绑定不同的 occurrence:

```typescript
const layer = e2bSandbox({ template: "niceeval-agents" })
  .before(async (sandbox, context) => {
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

两条反馈通道语义互斥,调用方只能把一次观测归入其中一类:

- `progress` 是当前 before 的短期状态，例如正在检查、下载或预热；它不进入最终结果。
- `diagnostic` 是真实异常、退化或需要处理的问题,会进入永久输出。
  正常容量、缓存大小、版本和命中状态本身是中性观测,不能无条件伪装成 warning。
  只有达到明确且可解释的风险条件时才上报 diagnostic。若某条受管命令实际观察到中性值，值只随该命令的有界
  Observability capture 留存；不会另建可携带值。

反馈通道不能指定 phase——runner 从当前 command 的 owner 自动得出阶段。
反馈也不替代控制流：上例明确选择降级继续。如果 Sandbox 或当前操作无法继续，应直接抛出原错误，让 Runner 写具名 Observability execution diagnostic，并据此形成 `errored` Verdict。Attempt lifecycle 仍只收敛到 `completed` 或 `abandoned`。

计划内自变量必须同时进入 `flags`、model、agent、sandbox 配置等 fingerprint 输入；无法配置化的外部可变状态变化后用 `--rerun all` 重跑。

自定义 provider 在 `create` options 上取得绑定到 `sandbox.create` 的 `feedback`:

```typescript
import { Effect } from "effect";
import { CustomSandboxCreateError, defineSandbox } from "niceeval/sandbox";

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
    catch: (cause) => new CustomSandboxCreateError({
      code: "modal-allocation-failed",
      message: "Modal sandbox allocation failed",
      cause: cause instanceof Error ? cause : new Error(String(cause)),
    }),
  }),
});
```

provider 的 retry/backoff 与 SDK 原始日志也走这条反馈管线,不能直接写 `stdout` / `stderr`;这样 Human dashboard 不会被打散,CI 事件也能保持单一顺序。
完整 API 与其它入口的对应关系见 [Experiments · 生命周期代码怎样向这次运行反馈](../experiments/library.md#生命周期代码怎样向这次运行反馈)。

## 沙箱预置放哪

要在跑 agent 前预置好 Sandbox,按职责分摊到下面几处——**每一处都是普通代码,不是框架编排**:

| 要准备的东西 | 放哪 | 怎么收尾 |
|---|---|---|
| 所有 attempt 都相同、无需运行中 daemon 的重依赖(系统包、CLI、二进制、大模型 cache) | provider 原生 image/template/snapshot 构建脚本;template factory 只引用构建结果 | provider 的 image/template/snapshot 生命周期管理 |
| 必须等 Provider ready 后生成的确定性状态 | [可缓存 before](architecture.md#准备前缀的身份与验证边界)；typed inputs、owner 与数值顺序决定 SetupPrefixKey | 普通 Docker 恢复 exact image；Incus 恢复完整 verified Provider artifact；其它 Provider 如实 replay |
| **这个实验**整场一份、宿主机侧的共享服务(隧道、每实验专用 mock server、license 租约) | [`ExperimentDefinition.setup`](../experiments/library.md#实验级共享服务setup-与-teardown):整场一次,第一个要派发的 attempt 前跑 | `ExperimentDefinition.teardown`,全部 attempt 收尾后执行(中断也执行;setup 时点走到过才触发) |
| **这次实验**才知道的沙箱内内容(工具检查与安装、小配置、预检) | Experiment layer 的 [`before()`](layers.md);每次 occurrence 可以 restore 或 replay | 成功取得的外部资源用 `context.onCleanup()` 登记释放;沙箱内文件随销毁自动没了 |
| **这条 eval** 的题目准备(checkout、依赖)与任务 Fixture | Eval layer 的 [`before()`](layers.md),或 `test(t)` 里的普通代码(`t.sandbox.writeText` / `writeBytes` / `runCommand`) | 随沙箱销毁或题间 reset;无条件收尾用 `after()`,条件释放用 `context.onCleanup()` |
| Agent CLI 的精确版本(每 Attempt 探测) | Adapter 必填 `ensure` + identity 匹配的 [`AgentInstaller`](../adapters/architecture/agent-ensure.md)；Runner 负责 探测、缺失时安装、复检 | 安装失败归 `agent.ensure`；安装的文件随 Sandbox 销毁或题间复用策略处理 |
| 连 agent、写鉴权、主配置与扩展(每 Attempt 一次) | [`SandboxAgent.setup`](../adapters/architecture/agent-contract.md#生命周期不变量)；要读写 Agent 安装文件的后续脚本走 factory 的 [`postSetup`](../adapters/library/coding-agent-extensions.md#安装后运行脚本postsetup) | 随 Sandbox 销毁；要收尾的动作挂成对的 `preTeardown`，逆序且先于 Agent teardown |
| 跨 Attempt 的沙箱内状态(记忆库、累积笔记) | Experiment callback before 恢复状态并用 `context.onCleanup()` 登记回存；planning 验证 owner 对 cohort 稳定 | cleanup 在最后一个 Attempt 后、provider finalizer 前逆序运行；`maxConcurrency: 1` 只保证本 Invocation 串行，多个 Invocation 共用 checkpoint 时还要声明 Experiment `sharedState.key` |
| **跨实验共享**、这次 run 之前就该存在的外部服务(共享 DB、公司内网服务本体) | 外部编排:`docker compose up -d && niceeval exp … && docker compose down`,或 CI 脚本 | 外部编排负责,URL 经 env 传入 agent / eval |

分工只看两个维度——**随什么变化**(实验 / eval / 都不随)与**活在哪一侧**(宿主机 / 沙箱内)。
宿主机侧、每实验一份的服务进 `ExperimentDefinition.setup`;沙箱内、按实验变的安装内容(装什么、开不开预热)进 Experiment layer。
题目材料按 eval 变(这条题目需要哪些起始文件)进 Eval layer 或 `test(t)`。
agent 怎么连自己是 agent 的私事。
跨实验、生命周期长于一次 run 的资源交给外部编排。

## 自定义 provider:`defineSandbox`

只在自己项目里用、不打算贡献回 niceeval 时,用 `defineSandbox`(`niceeval/sandbox` 导出)——传 `create()` 直接产出一个实现 `Sandbox` 接口的实例。
它构成一个自定义 template-bearing layer;身份、能力与留存义务见 [Case · 自定义 case](case.md#自定义-case):

```typescript
import { Effect } from "effect";
import { CustomSandboxCreateError, defineSandbox } from "niceeval/sandbox";

export default defineSandbox({
  name: "modal",                          // 只用于展示 / 日志,不参与分发
  targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
  recommendedConcurrency: 8,               // 可选;省略默认 5
  create: ({ deadline, runtime, feedback }) => Effect.try({
    try: () => {
      feedback.progress({ message: "allocating Modal sandbox" });
      // 返回实现 runCommand/readText/readBytes/writeText/writeBytes/stop 等接口的实例
      return new MyModalSandbox({ deadline, runtime });
    },
    catch: (cause) => new CustomSandboxCreateError({
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
留存后的 `niceeval sandbox stop` 是不加载 config / eval 模块的新进程,无法安全找回用户对象上的销毁函数;框架也不会用“删登记项、让用户手工销毁”冒充完整生命周期。
组合使用会在调用 `create()` 前报错,不会先起一个无法纳管的实例。

要贡献进 niceeval 本体(像 docker/vercel/e2b 那样内置)走另一条路,见 [Architecture · 再接一个 provider](architecture.md#再接一个-provider)。

## 相关阅读

- [README](README.md) ——为什么需要沙箱、provider 统一接口。
- [Sandbox Layer](layers.md) —— `sandbox` 声明:template 配对、准备命令与顺序。
- [Nested Docker](nested-docker/README.md) —— `sandboxLayer({ requirements })` 与 `incusSandbox()`。
- [三方准备时序](lifecycle.md) —— link 规划、action schedule 与 fresh / reuse 次数。
- [预制实例](library/prebuilt-environments.md) ——各 provider 的构建工作流、官方 agent 起点与运行时 checkpoint。
- [CLI](cli.md) —— `--keep-sandbox` 留存现场与 `niceeval sandbox` 销毁命令。
- [操作 Sandbox](library/operations.md) —— `t.sandbox` 的文件与命令 API。
- [断言 Sandbox 结果](library/asserting-results.md) —— diff、文件和 shell 行为怎么评分。
- [Architecture](architecture.md) —— provider 内部实现、生命周期时序、性能与重试。
