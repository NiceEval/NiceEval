# PLAN-6 —— Library 候选形状

**相关文档**:[方案](README.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md) · [CASES](../CASES.md)

本方案尽量复用现有公开面。
Eval 继续使用 `environment` 与 `setup`,Experiment 继续在 `sandbox` 上选择 Provider 并追加 setup。

## Eval Environment

```typescript
type EvalEnvironment = string | SandboxSource;
```

字符串是 environment profile。
`SandboxSource` 是 folder-local、provider-neutral 的环境输入,例如 Compose 文件、主 service 与 build context。

folder-local 的完整形态是「task package 就是 eval 文件夹」:环境、判据与 eval 定义同目录,全部路径从 `import.meta.url` 推导:

```text
evals/terminal-bench/broken-python/
  eval.ts                  # 文件夹入口:题面、标签与预算内联在这
  docker-compose.yaml      # 环境:同目录 compose + Dockerfile
  Dockerfile
  run-tests.sh             # 判据:agent 收工后才挂载
  tests/
  .dockerignore            # 判据与答案不进 build context
```

```typescript
export default defineEval({
  environment: composeSandbox({
    file: new URL("docker-compose.yaml", import.meta.url),
    mainService: "client",
  }),
  async test(t) {
    await t.send(TASK);
  },
});
```

Eval 不返回 Provider-native Sandbox Case。
source 只有经过当前 SandboxSpec 的覆盖表或 materializer,才成为运行 case。

## 数据集 adapter 派生 Environment

外部 benchmark 已经把环境放进 task package 时,迁移者不逐题重写 `environment:`。
adapter 读取原格式并返回普通 EvalDef record:

```typescript
// evals/terminal-bench.eval.ts
export default await loadTerminalBench({
  root: new URL("../vendor/terminal-bench/original-tasks/", import.meta.url),
  revision: TERMINAL_BENCH_REVISION,
});
```

`loadTerminalBench()` 不是 NiceEval core 的第二套 Eval API。
它是 benchmark-specific helper,内部为每个 task 调用 `defineEval()` 并派生:

- `task.yaml` 对应的 instruction、timeout、tags 与 metadata。
- Compose 与公开 build inputs 对应的 `SandboxSource`。
- `run-tests.sh` 与 `tests/**` 对应的 hidden verifier。
- solution 对应的 private reference 排除规则。

adapter 必须稳定排序 task id,登记各类输入身份,并检查 private/verifier 不会进入 build context 或 bind mount。

## Experiment Sandbox setup

Experiment 的默认起点与环境准备都留在 SandboxSpec:

```typescript
export default defineExperiment({
  sandbox: e2bSandbox({
    template: mempalTemplate("codex"),
  }).setup(mempalSetup({
    version: "0.9.0",
    modelDigest: MODEL_SHA256,
  })),
  agent: codexAgent({ skills: [mempalSkill] }),
});
```

`template` 只在 Eval 没有 Environment 时成为起点。
`.setup(...)` 始终作用于最终解析出的主 Sandbox,所以同一个 mempal setup 也能作用在 Terminal-Bench Compose 的 `client` 上。

多个实验准备按链式顺序执行:

```typescript
sandbox
  .setup(companyCertificates(...))
  .setup(internalRegistry(...))
  .setup(mempalSetup(...));
```

作者不再声明 `dependsOn` 或 `resources`。
顺序有语义时直接按阅读顺序写;领域 helper 内部可以对自己掌握的独立动作安全并行。

## EvalDef setup

只随题目变化的准备放在 EvalDef setup:

```typescript
export default defineEval({
  setup: nodeRepositoryFixture({
    url: "https://github.com/Hacker0x01/react-datepicker.git",
    commit: "bd3ab113a4d5b6f092017e54d29b7678195c9613",
    install: ["corepack", "yarn", "install", "--immutable"],
  }),
  async test(t) {
    await t.send(TASK);
  },
});
```

这仍是普通 `EvalDef.setup`。
`nodeRepositoryFixture()` 只是减少重复的领域 helper;作者也可以写现有的 async setup function。

仓库 checkout、项目依赖与可见 Fixture 在 Agent 前完成。
隐藏 verifier 不属于 setup,必须等最后一次 Agent turn 返回后再 materialize。

## 可验证 setup helper

昂贵或可能预装的条件使用领域 helper 封装 check/install/recheck:

```typescript
const mempalSetup = defineSandboxSetup({
  identity: {
    tool: "mempal",
    version: "0.9.0",
    modelDigest: MODEL_SHA256,
  },
  async check(ctx) {
    return inspectMempal(ctx.sandbox);
  },
  async install(ctx) {
    const payload = await ctx.stage(mempalPayload(ctx.targetPlatform));
    await installMempal(ctx.sandbox, payload);
  },
});
```

普通作者消费 `mempalSetup({...})`,不实现这个底层形状。
`identity` 进入配置身份;check 的实际 facts、install activity 与 recheck 进入 Attempt 记录。

plain setup function 继续允许,但它每次执行且不享受预装命中或受管 staged payload。
需要这些能力时才使用 `defineSandboxSetup()`。

## SandboxSpec 解析入口

```typescript
interface SandboxSpecEnvironmentInputs<NativeCase> {
  readonly environments?: Readonly<Record<string, NativeCase>>;
  readonly materializers?: Readonly<
    Record<string, SandboxSourceMaterializer<NativeCase>>
  >;
}
```

`environments` 表项必须兑现同一 profile 对应 Environment 的外部行为。
预制产物怎样携带构建时的 source provenance 尚未定稿;配置不能从当前 source 动态计算一个声明值,再用它证明既有产物没有过期。

固定解析顺序是:

```text
environments[profile]
  > matching materializer(source)
  > SandboxSpec default case when Eval has no Environment
  > Provider neutral case
```

有 source 但当前 SandboxSpec 没有覆盖或 materializer 时,该 Eval 在计划期 `skipped`。
Runner 不回退到默认 template。

## Agent 保持独立

AgentProvisioner 保留平台探测、staged payload、安装模式、check/install/recheck 与逐 Attempt 安装事实。
它在 SandboxSpec setup 与 EvalDef setup 之后运行,不改成通用 Sandbox setup helper。
