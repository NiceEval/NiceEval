# Lifecycle —— 环境的起停钩子

评测要在"干净又就绪"的环境里跑。而"环境"因实验而异:起一个 mock API、装一组额外依赖、连一个外部 DB、跑完再把这些关掉。fastevals 把这些**起停**收敛成一组分层、同构的生命周期钩子:核心负责固定编排(沙箱起停、上传、git 基线、采 diff、跑验证),用户钩子只填"我这套环境怎么起、怎么停"。

> 承重墙重申(见 [Vision](vision.md#边界画在行为上)):钩子是**中性**的 —— 它让用户在固定编排的缝隙里插自己的环境逻辑,而不需要核心按 agent / sandbox 名字分支。这正是"一个中性的小 hook,几乎总比把 `name === ...` 的分支穿过核心要干净"的落点。

## 一个 `hooks` 对象,作用域同构

所有生命周期钩子收在一个 `hooks` 对象里,**动词统一为 `setup` / `teardown`,作用域是结构 key**。没有 `globalSetup` 这种"特殊前缀" —— 每个作用域完全平权,读法一致、可平滑扩展:

```typescript
type Cleanup = () => Promise<void> | void;

interface LifecycleHooks {
  run?: {                                                          // 整轮一次
    setup?:    (run: RunContext) => Promise<void | Cleanup>;
    teardown?: (run: RunContext) => Promise<void>;
  };
  sandbox?: {                                                      // 每次运行(每个 attempt)
    setup?:    (sandbox: Sandbox, ctx: AgentContext) => Promise<void | Cleanup>;
    teardown?: (sandbox: Sandbox, ctx: AgentContext) => Promise<void>;
  };
  // eval?: { setup?, teardown? }  ← 预留扩展点:一条 eval 跨其 N 个 attempt 一次
}
```

`defineConfig` 与 `defineExperiment` 都接受 `hooks?: LifecycleHooks`。把作用域做成 key(而非词缀)的好处:**加第三个作用域**(`hooks.eval`,seed 一次 DB 给该 eval 的全部 attempt 用)时,动词不变、结构不破 —— 而 `globalSetup` / `setup` 那种扁平命名加到第三个就只能叫 `evalSetup`,三个名字三种风格。

## 三个嵌套作用域

```text
RUN(一次 fastevals 调用 = 一个实验矩阵)
│  hooks.run.setup(run)            ← 全程一次:起共享环境(mock API、license、共享 DB、预热)
│
├── ATTEMPT(eval × model × run 的一次运行)—— 沙箱作用域
│   │  Sandbox.create / 从池中领取
│   │  prepareWorkspace(上传 workspace,藏起 EVAL.ts,git 基线)
│   │  hooks.sandbox.setup(sandbox, ctx) → 可选 cleanup 闭包   ← 单次预置(写 .env、起服务、装依赖)
│   │  npm install
│   │  agent.send(adapter 在沙箱里跑 agent)
│   │  runValidation(上传 EVAL.ts,跑测试 + scripts)
│   │  captureGeneratedFiles(git diff HEAD)
│   │  hooks.sandbox.teardown(sandbox, ctx) / cleanup()       ← 单次清理(finally,必跑)
│   │  Sandbox.stop / 重置回池
│   └── …更多 attempt(有界并发)
│
│  hooks.run.teardown(run)         ← 全程一次:停共享环境(finally,必跑)
```

要点:

- **run 作用域**装"整轮共享、起停各一次"的东西。
- **sandbox 作用域**装"每次运行各自需要、用完即清"的东西,跟着沙箱走(每个 attempt 都跑一遍)。
- 两层都成对(`setup` / `teardown`),**`teardown` 一律在 finally 里跑** —— 失败也跑,不漏资源。

## 哪个作用域放哪 —— 和已有边界一致

fastevals 已经把边界定死:**config = 环境与默认,experiment = 怎么跑这批,eval = 测什么**。生命周期钩子照这条线落位:

| 钩子 | 作用域 | 归属 | 干什么 |
|---|---|---|---|
| `hooks.run.setup` / `.teardown` | run | config(默认)+ experiment(叠加) | 起停整轮共享环境 |
| `hooks.sandbox.setup` / `.teardown` | sandbox(每个 attempt) | config(默认)+ experiment(叠加) | 起停单次运行的环境 |
| `Sandbox.create` / `stop` / `reset` | backend | sandbox 后端实现 | 容器 / VM 本身的起停与复用 |

**eval 不持有环境起停钩子** —— "测什么"不该决定"环境怎么起",否则同一条 eval 换个 agent / 实验就跑不了了。这跟"从 agent-eval 砍掉 `validation` / `scripts` 不进 experiment"是同一条纪律的两面:**环境配置不进 eval,评分逻辑不进 experiment。**(注:`hooks.eval` 这个**预留扩展点**仍属 config / experiment 持有,只是"按 eval 分组跑一次",不是把钩子写进 eval 定义。)

### config 与 experiment 钩子如何叠加

两层都能定义同名钩子,它们**叠加,不互相替换**:config 的先跑(搭项目通用底座),experiment 的后跑(加这次矩阵特有的)。`teardown` 反序执行(后进先出,像 `defer` 栈)。把两个维度(config↔experiment、run↔sandbox)合起来,完整顺序是:

```text
hooks.run.setup:        config → experiment        (整轮一次)
  hooks.sandbox.setup:    config → experiment        (每个 attempt)
  hooks.sandbox.teardown: experiment → config        (每个 attempt,反序)
hooks.run.teardown:     experiment → config        (整轮一次,反序)
```

这样"所有实验都要的 mock server"写一次在 config,"这个实验额外要的 feature-flag 服务"写在 experiment,互不覆盖。

## 用法

### sandbox 作用域:每次运行的环境

`setup` **可返回一个 cleanup 闭包**(defer 风格,最省心),或写一个对称的独立 `teardown`(手上没有句柄、或想分开写时用)。

defer 风格(推荐 —— 闭包直接抓住它起的资源,不用塞 `ctx` 再找回来):

```typescript
hooks: {
  sandbox: {
    setup: async (sb, ctx) => {
      const server = await startMockApi();
      await sb.writeFiles({ ".env": `API_URL=${server.url}\n` });
      return async () => { await server.close(); };   // ← 跑完自动调用
    },
  },
},
```

独立 `teardown`(适合清沙箱内的东西,句柄就是 `sandbox` 本身):

```typescript
hooks: {
  sandbox: {
    setup:    async (sb) => { await sb.runShell("docker compose up -d db"); },
    teardown: async (sb) => { await sb.runShell("docker compose down -v"); },
  },
},
```

两者可并存:cleanup 闭包先跑,再跑 `teardown`。

### run 作用域:整轮的共享环境

`hooks.run.setup` 的产物经 `run.share(...)` 暴露给每个 attempt 的 **`ctx.shared`**(只读)。比如起一个 mock server,把 url 共享下去,再由各 attempt 的 `hooks.sandbox.setup` 写进各自沙箱的 `.env`:

```typescript
// fastevals.config.ts —— 所有实验共享
export default defineConfig({
  hooks: {
    run: {
      setup: async (run) => {
        const api = await startMockApi();
        run.share("apiUrl", api.url);
        return async () => { await api.close(); };   // run 结束自动关
      },
    },
    sandbox: {
      setup: async (sb, ctx) => {
        await sb.writeFiles({ ".env": `API_URL=${ctx.shared.apiUrl}\n` });
      },
    },
  },
});
```

`RunContext` 的形状:

```typescript
interface RunContext {
  readonly experimentId?: string;
  readonly evals: readonly string[];     // 这轮要跑哪些 eval 的 id
  readonly agents: readonly string[];
  readonly flags: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;          // 整轮取消
  log(msg: string): void;
  share(key: string, value: unknown): void;   // 把 setup 起的东西传给每个 attempt
}
```

为此 [`AgentContext`](agents-and-adapters.md#agent-契约) 增一处只读字段 **`ctx.shared`**(`hooks.run.setup` 经 `run.share` 放进来的东西);eval 侧对应只读的 `t.shared`。

## 错误语义 —— 和现有错误隔离对齐

[Architecture](architecture.md#错误隔离) 已定三类错误隔离。生命周期钩子按作用域接上:

| 钩子抛错 | 处置 |
|---|---|
| `hooks.run.setup` | **中止整轮** —— 共享环境起不来,没法跑。已跑过的 run.setup cleanup 反序执行,发 `run:setupFailed`,非零退出。 |
| `hooks.sandbox.setup` | **隔离成该 eval `failed`** —— 和执行器异常同级,其余 eval 照跑。已经起来的部分照样进 teardown 清理。 |
| `teardown` / cleanup(任一作用域) | **不改判决** —— 评分已定。错误记成该结果的 diagnostic,发 `*:teardownFailed`,并 log 警告。资源可能泄漏,所以要显眼,但不能让"清理失败"把一个已经 `passed` 的 eval 翻成 `failed`。 |
| `hooks.run.teardown` | 同上:log + `run:teardownFailed`,不改已出的 summary。 |

一条铁律:**`teardown` 一律在 `finally` 里调。** `setup` 抛在半路时,defer 风格的 cleanup 闭包还没来得及返回 —— 所以 `setup` 内部起多个资源时,要么自己 `try/finally`,要么用独立 `teardown`(它只要沙箱在就会跑)。

## 与沙箱复用 / 预热的关系

[Sandbox 性能](sandbox.md#性能复用与预热)允许沙箱跨 case 复用(reset 回基线而非销毁)。生命周期照样成立,只是嵌套关系要清楚:

```text
Sandbox.create(或从池领取)
│  ├─ ATTEMPT A: prepareWorkspace → sandbox.setup → … → sandbox.teardown → reset
│  └─ ATTEMPT B: prepareWorkspace → sandbox.setup → … → sandbox.teardown → reset
Sandbox.stop(或还池)
```

- **`hooks.sandbox.setup` / `teardown` 跟着 attempt,不跟着容器** —— 复用时每个 attempt 都重跑 `setup`(它的环境是每次运行的私事),`teardown` 在 reset 前跑。
- **容器级的起停**(装基础镜像、预热)是 backend 的 `create` / `reset` / `stop`,**不是用户钩子**。要定制基础镜像,走 sandbox 后端选项(`sandbox: { backend, image, env }`),不是 `hooks.sandbox.setup`。
- 经验法则:**"每次运行都要重来一遍的"进 `hooks.sandbox.setup`;"整个容器生命周期一次就够的"进镜像 / backend。**

## 不和 reporter 冲突 —— 资源 vs 分析

experiment 当初**砍掉了 `onRunComplete`**(见 [Experiments 砍字段](experiments.md#从-agent-eval-砍掉了什么以及为什么)),理由是"下游分析交给 reporter,别搞两套钩子"。生命周期钩子不违反这条,因为它们管的是**另一件事**:

| | 生命周期钩子 | reporter |
|---|---|---|
| 管什么 | **资源**的起停(服务、DB、外部连接、临时账号) | 结果的**消费**(落盘、上报、二次评分) |
| 时机 | 阻塞在关键路径上(run 依赖它就绪) | 独立串行队列,不阻塞执行池 |
| 能否影响运行 | 能(`hooks.run.setup` 失败 → 整轮中止) | 不能(纯消费,绝不改判决) |
| 典型 | 起 mock API、`docker compose up`、连 license server | `onEvalComplete` 打印、写 JUnit、推 Braintrust |

口诀:**要"起停一个东西"用生命周期钩子;要"消费结果"用 reporter。** 两者正交,不重叠。

> 命名上两者也同源:reporter 用 `on<作用域><阶段>`(`onRunStart` / `onEvalComplete`)观测,生命周期钩子用 `hooks.<作用域>.<阶段>`(`hooks.run.setup`)起停 —— 作用域都是显式的一档维度。

## 生命周期事件

在 [Runner 事件](runner.md#生命周期事件)基础上补一组(供 dashboard / reporter / 外部集成观测起停进度):

```text
run:setup              { }                          # hooks.run.setup 开始
run:setupComplete      { durationMs }
run:setupFailed        { error }                    # → 整轮中止
sandbox:created        { id, backend, evalId, attempt }
attempt:teardownFailed { evalId, attempt, error }   # hooks.sandbox.teardown 抛错
sandbox:stopped        { id }
run:teardown           { }
run:teardownFailed     { error }
```

attempt 级 `hooks.sandbox.setup` 的开始 / 结束并入既有 `eval:start` / `eval:complete`,不另发事件,避免噪声。

## 一页速查

| 我要… | 用 | 写在 |
|---|---|---|
| 整轮起一个共享服务 / DB,跑完关 | `hooks.run.setup`(返回 cleanup) | config / experiment |
| 每个沙箱写 `.env`、装额外依赖、起本地服务 | `hooks.sandbox.setup`(返回 cleanup) | config / experiment |
| 每个沙箱跑完清掉它起的东西 | cleanup 闭包 或 `hooks.sandbox.teardown` | config / experiment |
| 一条 eval 的全部 attempt 共享一次预置 | `hooks.eval.setup`(预留扩展点) | config / experiment |
| 定制容器基础镜像 / 预装包 | sandbox 后端选项,**不是钩子** | `config.sandbox` |
| 跑完上报 / 打印 / 二次评分 | reporter,**不是钩子** | `config.reporters` |
| 决定"怎么算对" | eval 的 `test()` / `EVAL.ts`,**不是钩子** | `evals/` |

## 相关阅读

- [Experiments](experiments.md) —— `hooks` 在实验里的位置与字段。
- [Sandbox](sandbox.md) —— 沙箱生命周期编排与复用。
- [Runner](runner.md) —— 钩子在调度里的执行顺序与事件。
- [Observability](observability.md#reporters) —— reporter:消费结果而非起停资源。
- [Vision](vision.md) —— 为什么钩子是中性的、核心不按名字分支。
</content>
