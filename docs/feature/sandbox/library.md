# Sandbox —— 库用法

`t.sandbox`(eval 作者)与 `experiment.sandbox` / `config.sandbox`(选 provider)是这个功能的两个入口。本篇讲怎么调用;内部怎么实现见 [Architecture](architecture.md)。

## 路径与 workdir:一个坐标系

每个 provider 的 agent 默认工作目录不同——这是**provider 的知识,不是 eval 作者的负担**:

| provider | workdir |
| --- | --- |
| docker | `/home/sandbox/workspace` |
| E2B | `/home/user/workspace` |
| Vercel Sandbox | `/vercel/sandbox` |

契约一句话:**API 里任何沙箱侧相对路径,一律解析到 `workdir`;省略的 `targetDir` / `cwd` 默认就是 `workdir`;绝对路径原样使用。** 本地侧(宿主机)的相对路径则解析到 eval 定义文件所在目录。两侧各只有一个锚点,学一次就够。

为什么 workdir 是唯一正确的默认值:整条流水线都锚定在它上面——变更分类账以它为 work-tree、agent 的 cwd 在那里、send 窗口的改动在那里折叠成 agent diff、`t.sandbox.fileChanged(...)` 的路径也是对着那里解析的。把起始文件传到任何**别的**目录,agent 看不见它,diff 也采不到它,整条 eval 静默失效。所以对上传起始 workspace 这个最高频调用来说,workdir 不是"常见选择",是唯一能让系统其余部分正常工作的选择——一个参数如果 99% 的调用只有一个正确值,而调用者又不掌握这个值(它随 provider 变),强制填写就不是"显式更安全",是逼人抄错答案。

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

消掉的东西:`import.meta.url` 拼路径的咒语、两处 hardcode 的 provider 专属绝对路径,以及"切换 provider 文件落到 agent 视野之外"这个静默 bug 的整个物种。用户对"文件在哪"的心智模型收敛成一句话:**一切相对路径都在 workspace 里**——和 git 的 repo 相对路径同构,不需要关心物理位置。

### 逃生舱:`sandbox.workdir`

绝对路径不会彻底消失,三种场景会穿透坐标系:往 prompt 里告诉 agent 一个路径、对照 agent 日志/工具输出里出现的绝对路径、`docker exec` 进容器手动调试。这时用 `workdir` 属性,不要背表:

```typescript
await t.send(`参考 ${t.sandbox.workdir}/docs/CONVENTIONS.md 里的约定实现组件。`);
```

注意 `$HOME` 这类环境变量不是替代品:`targetDir` 是宿主侧 JS 里拼的字符串,shell 变量根本不展开——`uploadDirectory(dir, "$HOME/workspace")` 会真的创建一个叫 `$HOME` 的目录。运行时 `runShell("pwd")` 探测也不必要:workdir 是 provider 构造时就确定的静态字符串,声明就能解决的问题不用运行时手段。

### 为什么不伪造一个统一的 `/workspace`

另一条路是让所有 provider 都真的提供 `/workspace`(mkdir + symlink 到真实 workdir)。不走这条:`/workspace` 不是 agent 实际的 cwd,agent 的日志、工具输出、报错里出现的全是真实路径,伪造的统一路径会让用户在对照时更糊涂;云 provider(vercel/e2b)对用户目录之外的文件系统权限也未必允许。这与「用户与 root」一节是同一处理哲学:**语义跨 provider 一致(相对路径→workdir),物理值诚实暴露差异(`workdir` 属性)**,不假装统一。

实现细节(路径解析规则收敛在哪个文件、一份实现如何跨 provider 共用)见 [Architecture · 实现纪律](architecture.md#实现纪律)。

## 用户与 root

**默认非 root,按需提 root** —— 命令默认以沙箱的标准**非 root** 用户跑(agent 的自然环境:安全,且 Claude Code 等在 root 下会拒绝 `--dangerously-skip-permissions`)。需要 root 的命令(setup 装系统依赖:`apt-get install …`、`pip install --break-system-packages …`)给 `runCommand` 传 `{ root: true }`。

```typescript
// eval setup:只有装系统依赖这步提 root;其余(含 agent、验证)默认非 root。
await sandbox.runCommand("apt-get", ["install", "-y", "openjdk-17-jdk"], { root: true });
await sandbox.runCommand("npm", ["install"]);   // 默认非 root,cwd 默认 workdir
```

**这套语义跨 provider 一致**,且与主流沙箱服务同构 —— 三个内置 provider 各自把 `{ root: true }` 映射到自己的原生机制:

| provider | 默认用户 | `{ root: true }` 映射 |
| --- | --- | --- |
| docker | `node`(UID 1000) | `exec --user root` |
| E2B | 非 root(`user`) | `commands.run(cmd, { user: "root" })` |
| Vercel Sandbox | 非 root(`vercel-sandbox`) | `runCommand(cmd, { sudo: true })` |

约定:**默认值(非 root)与 `root` 的语义在所有 provider 保持一致**,不因 provider 而变——自定义 provider(`defineSandbox()`)接哪个服务都照这条约定映射到该服务的原生机制。本就全程 root 的服务把提 root 视作 no-op;完全无法提 root 的服务可不支持(抛错)—— 但这是"不支持",不是"语义不同"。eval 因此不必感知底下是哪个 provider。

## provider 选择:没有默认值,没有按名字选

`sandbox` 字段的类型是 `SandboxOption`(= `SandboxSpec`,一个按 `provider` 区分的数据结构),**不接受裸字符串,也不会自动探测环境替你选一个**。沙箱型 agent 必须显式给 `sandbox` 一个工厂函数产出的 spec,写在 experiment 的 `sandbox` 字段,或写在 `niceeval.config.ts` 的 `sandbox` 字段做全项目兜底(`config.sandbox`,experiment 没设时用它)。两处都没设、又用了沙箱型 agent 时,`resolveSandbox()` 直接抛错,不会替你猜环境、不会静默兜底到某个 provider。也没有 `--sandbox <name>` 这种 CLI 覆盖——provider 选择是 experiment/config 的书面配置,不是运行时临时参数。

```typescript
import { defineExperiment } from "niceeval";
import { dockerSandbox } from "niceeval/sandbox";
import { claudeCodeAgent } from "niceeval/adapter";

export default defineExperiment({
  agent: claudeCodeAgent(),
  sandbox: dockerSandbox(),   // 必填,沙箱型 agent 没有它就报错
});
```

## Sandbox 作为数据结构(带参数)

provider 名只是个字符串,带不了参数,也没法表达"哪个是镜像、哪个是沙箱快照 ID"。和 [agent](../adapters/README.md) 一样,sandbox 用**数据结构**定义:工厂函数(从 `niceeval/sandbox` 导出)产出 spec,放进 `experiment.sandbox`。

```typescript
import { dockerSandbox, vercelSandbox, e2bSandbox } from "niceeval/sandbox";

dockerSandbox()                                     // docker:用默认镜像
dockerSandbox({ image: "niceeval-agents:node24" })  // docker:指定镜像
vercelSandbox({ snapshotId: "snap_xxx" })            // vercel:从沙箱快照起
e2bSandbox({ template: "niceeval-agents" })          // e2b:指定模板
```

`sandbox/resolve.ts` 把 spec 归一化成 `{ provider, image?, snapshotId?, template?, runtime? }`,再按 `provider` 派发到各 provider 的 `create()` —— **核心仍不按 provider 名分支**,参数只在对应 provider 的 `create()` 里消费。

参数的典型用途是**预制环境**:把 agent CLI 烘焙进镜像/模板,让后续 eval 跳过安装直接开跑。

### 可发布预制环境

稳定、体积大、每个 attempt 都相同的内容(系统包、agent CLI、编译好的二进制、模型 cache、固定工具链)应在跑 eval 之前做进 provider 的可发布产物,attempt 从产物起实例:Docker 的 image、E2B 的 template、Vercel 的 snapshot。构建归 provider 原生工具,NiceEval 只消费 typed spec 里的产物 ID;`sandbox.setup` 只处理必须按 experiment / attempt 变化的小配置、状态恢复和 fail-fast 预检。

各 provider 的构建工作流、官方 coding agent 起点、自己写预制环境的 DX、新 provider 的义务与运行时 checkpoint,见 [预制环境](library/prebuilt-environments.md)。

## 沙箱生命周期钩子:`.setup()` / `.teardown()`

`dockerSandbox()` / `e2bSandbox()` / `vercelSandbox()` 这些工厂产出的 `SandboxSpec` 带两个链式方法:

```typescript
interface SandboxSpec {
  setup(fn: SandboxHook): SandboxSpec;       // 返回新 spec(不可变),可多次链式追加
  teardown(fn: SandboxHook): SandboxSpec;    // 同上
}

type SandboxHook = (
  sandbox: Sandbox,
  ctx: SandboxHookContext,
) => void | Cleanup | Promise<void | Cleanup>;
```

`SandboxHook` 与 `SandboxHookContext` 都从公开入口 `niceeval/sandbox` 导出。需要在共享 helper 上固定签名时直接导入类型，不要从某个 provider spec 的 `.setup` 参数反推：

```typescript
import type { SandboxHook, SandboxHookContext } from "niceeval/sandbox";
```

Sandbox hook 有自己的窄上下文,包含 `experimentId`、`signal` 与作用域绑定的 `progress/diagnostic`;它不借用包含 session、model、telemetry 的完整 `AgentContext`。`setup` 可以返回一个 cleanup 闭包。多次 `.setup()` 按追加顺序跑,多次 `.teardown()` 按追加的逆序跑(和「先进后出」的 agent/环境层顺序是同一条纪律,只是发生在环境层内部)。

这一层解决的是一类特定问题:**环境内容必须按实验变化,不能在构建期固定。** 写一份实验专属 hook、恢复状态、写入按 flags 变化的小配置、做环境预检——这些事静态镜像不知道本次 experiment。稳定的大依赖先做进 image/template/snapshot;钩子是运行时的薄层,不应成为每 attempt 重装工具链和下载大模型的默认位置。

```typescript
export default defineExperiment({
  agent: codexAgent({ mcpServers: [mempalMcp] }),
  sandbox: e2bSandbox({ template: "fasteval-agents-mempal" }) // 二进制和模型 cache 已预制
    .setup(mempalSetup("codex"))       // 预检、写 hook、载入状态
    .teardown(mempalTeardown("codex")), // 回存状态
  maxConcurrency: 1,                    // [载入…回存] 是临界区,声明式串行
});
```

这是一个真实的 downstream 场景:记忆条件测试里,MCP server(构造期配置,决定"有没有这个工具")走 `codexAgent({ mcpServers: [...] })`;环境层(这次实验要不要装某个二进制、预热、维护跨 attempt 的记忆状态)走 `.setup()` / `.teardown()`。两条职责线不混:MCP/skills/model 依旧只从 adapter factory 进,钩子不复制 factory 拥有的配置知识,见 [Adapter · 配置归属不变量](../adapters/architecture/agent-contract.md#配置归属不变量)。

跨 attempt 状态本身没有框架原语——没有 `persistentState` 这类东西。载入 / 回存是用户在 `setup` / `teardown` 里自己写的普通代码(读写一个外部 KV、文件、数据库,用什么都行);要用哪个键隔离不同实验的状态,靠 `ctx.experimentId`——`AgentContext` 新增的只读字段,值是路径推导的实验 id(与结果里 `experimentId` 同源),不经 experiment 跑时是 `undefined`。[载入…回存] 这段读写外部状态的代码是临界区,想让同一实验的 attempt 不并发踩踏,在 experiment 上声明 `maxConcurrency: 1` 即可串行,不需要框架另设锁。

失败语义与 agent 的 `setup` / `teardown` 完全对称:`sandbox.setup` 抛错按执行错误计(`verdict: "errored"`,基建问题,不是 agent 做题失败);`sandbox.teardown` 报错只记日志、不抛(收尾阶段的错误不应该让一个已经跑完的 attempt 变成失败)。

remote 型 agent(`kind: "remote"`)没有真实沙箱,`experiment.sandbox` 对它不参与、直接被忽略——钩子天然不会跑,不需要为此写 fail-fast 分支或额外校验。

## 向运行反馈进度与诊断

provider 创建和环境 hook 都可以向当前 `niceeval exp` 报告信息,但 runner 为它们绑定不同的 lifecycle scope:

```typescript
const sandbox = e2bSandbox({ template: "niceeval-agents" })
  .setup(async (sandbox, ctx) => {
    ctx.progress({ message: "installing memory helper", current: 1, total: 2 });
    await sandbox.runCommand("npm", ["install", "-g", "memory-helper"]);

    ctx.progress({ message: "warming memory index", current: 2, total: 2 });
    try {
      await warmIndex(sandbox);
    } catch (error) {
      ctx.diagnostic({
        code: "memory-warmup-degraded",
        level: "warning",
        message: "Memory warmup failed; continuing with a cold index",
        data: { reason: String(error) },
        dedupeKey: "memory-warmup-degraded",
      });
    }
  });
```

`progress` 只更新当前 sandbox setup 的短期 activity;`diagnostic` 才进入永久输出。它们不能指定 `sandbox-setup` 等 phase——runner 从当前 hook 自动得出阶段。诊断也不会吞掉或制造失败:上例明确选择降级继续;如果环境不可用,应直接抛出原错误,让 attempt 进入 `errored`。

自定义 provider 在 `create` options 上取得绑定到 `sandbox.create` 的 `feedback`:

```typescript
export default defineSandbox({
  name: "modal",
  async create({ timeout, runtime, feedback }) {
    feedback.progress({ message: "allocating Modal sandbox" });
    const instance = await allocateModal({ timeout, runtime });
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
});
```

provider 的 retry/backoff 与 SDK 原始日志也走这条反馈管线,不能直接写 `stdout` / `stderr`;这样 Human dashboard 不会被打散,CI 事件也能保持单一顺序。完整 API 与其它入口的对应关系见 [Experiments · 生命周期代码怎样向这次运行反馈](../experiments/library.md#生命周期代码怎样向这次运行反馈)。

## 环境预置放哪

要在跑 agent 前准备环境,按职责分摊到四处已有的地方——**每一处都是普通代码,不是框架编排**:

| 要准备的东西 | 放哪 | 怎么清理 |
|---|---|---|
| 所有 attempt 都相同的重依赖(系统包、CLI、二进制、大模型 cache) | provider 原生 image/template/snapshot 构建脚本;spec 只引用产物 | provider 的 image/template/snapshot 生命周期管理 |
| **这次实验**才知道的环境(小配置、预检、hook 文件、跨 attempt 状态) | [沙箱生命周期钩子](#沙箱生命周期钩子setup--teardown):`sandbox.setup()` / `.teardown()` | `teardown` 显式回收(回存状态、清外部资源);沙箱内文件随销毁自动没了 |
| 连 agent、装 CLI、写 agent 自己的主配置(每 attempt 一次) | [`SandboxAgent.setup`](../adapters/architecture/agent-contract.md#生命周期不变量) | 随沙箱销毁,无需手工清 |
| **这条 eval** 的任务夹具、对跑到它的所有实验都生效的沙箱预置 | `EvalDef.setup` 或 `test(t)` 里的普通代码(`t.sandbox.writeFiles` / `runCommand`) | 随沙箱销毁;要清沙箱外的东西用 `try/finally` |
| **整个 run 共享**的外部服务(mock API、共享 DB、license) | 外部编排:`docker compose up -d && niceeval exp … && docker compose down`,或 CI 脚本 | 外部编排负责,URL 经 env 传入 agent / eval |

四行分工只看"这东西该不该随实验变化、该不该随 eval 变化":环境按实验变(装什么、开不开预热)进沙箱钩子;任务材料按 eval 变(这条题目需要哪些起始文件)进 `EvalDef.setup` / `test(t)`;agent 怎么连自己是 agent 的私事;真正跨进程共享、这次跑之前就该存在的资源交给外部编排。没有第五个"实验级整场钩子"——`ExperimentDef` 仍然是纯配置数据,不携带任何生命周期字段;需要生命周期行为的场景,答案永远是上面四行之一。

## 自定义 provider:`defineSandbox`

只在自己项目里用、不打算贡献回 niceeval 时,用 `defineSandbox`(`niceeval/sandbox` 导出)——传 `create()` 直接产出一个实现 `Sandbox` 接口的实例,`resolve.ts` 认到 `create` 就直接调用,跳过内置 provider switch,不需要 niceeval 认识这个 provider 的名字:

```typescript
import { defineSandbox } from "niceeval/sandbox";

export default defineSandbox({
  name: "modal",                          // 只用于展示 / 日志,不参与分发
  recommendedConcurrency: 8,               // 可选;省略默认 5
  create: async ({ timeout, runtime, feedback }) => {
    feedback.progress({ message: "allocating Modal sandbox" });
    // 返回一个实现 Sandbox 接口(run/read/write/stop/...)的实例
    return new MyModalSandbox({ timeout, runtime });
  },
});
```

自定义 provider 不支持 `--keep-sandbox`。留存后的 `niceeval sandbox stop` 是不加载 config / eval 模块的新进程,无法安全找回用户对象上的销毁函数;框架也不会用“删登记项、让用户手工清理”冒充完整生命周期。组合使用会在调用 `create()` 前报错,不会先起一个无法纳管的实例。

要贡献进 niceeval 本体(像 docker/vercel/e2b 那样内置)走另一条路,见 [Architecture · 再接一个 provider](architecture.md#再接一个-provider)。

## 相关阅读

- [README](README.md) —— 为什么需要沙箱、provider 统一接口。
- [预制环境](library/prebuilt-environments.md) —— 各 provider 的构建工作流、官方 agent 起点与运行时 checkpoint。
- [CLI](cli.md) —— `--keep-sandbox` 留存现场与 `niceeval sandbox` 清理命令。
- [操作 Sandbox](library/operations.md) —— `t.sandbox` 的文件与命令 API。
- [断言 Sandbox 结果](library/asserting-results.md) —— diff、文件和 shell 行为怎么评分。
- [Architecture](architecture.md) —— provider 内部实现、生命周期时序、性能与重试。
