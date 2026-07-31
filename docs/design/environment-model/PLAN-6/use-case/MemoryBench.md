# MemoryBench:Experiment template,Eval setup

契约单源见 [Library · Experiment Sandbox setup](../library.md#experiment-sandbox-setup)与 [Library · EvalDef setup](../library.md#evaldef-setup)。

## 事实边界

MemoryBench 当前已经呈现相反方向的路径:

- Experiment 选择 E2B template。mempal 变体使用预装 mempal 的派生 template,并通过 sandbox setup/teardown 管理工具状态。
- Eval 没有 environment source。以 `react-datepicker/pr-6058` 为例,题目代码 checkout 固定 commit 后执行 `yarn install`,再让 Agent 完成任务。

当前仓库把 checkout 与依赖安装写在 `test(t)` 中。
迁移到 NiceEval 的目标形状是把这段前置工作提到 `EvalDef.setup`,不把它重新包装成 Environment contribution。

## Eval

```typescript
// evals/react-datepicker/pr-6058.eval.ts
export default defineEval({
  setup: nodeRepositoryFixture({
    url: "https://github.com/Hacker0x01/react-datepicker.git",
    commit: "bd3ab113a4d5b6f092017e54d29b7678195c9613",
    removeRemote: true,
    removeFutureHistory: true,
    install: ["corepack", "yarn", "install", "--immutable"],
  }),
  async test(t) {
    await t.send(TASK);
    await t.verifier.using(datepicker6058Tests, async ({ sandbox }) => {
      t.check(
        await sandbox.runCommand("bash", ["tests/run-tests.sh"]),
        commandSucceeded(),
      );
    });
  },
});
```

这条 Eval 没有 Environment。
Runner 先使用当前 SandboxSpec 的默认 case,再执行这条 Eval 的 setup。

`nodeRepositoryFixture()` 是 Eval setup helper。
它锁定仓库 URL、commit、包管理器命令与 helper revision,并把进度和失败归到 `eval.setup`。
作者也可以直接写 async `setup`;不需要学习 Requirement、Base 或融合 case。

## Experiment

```typescript
// experiments/compare/codex-gpt-5.6-luna--mempal.ts
export default defineExperiment({
  evals: [
    "react-hook-form/",
    "react-datepicker/",
    "downshift/",
    "react-tooltip/",
    "yet-another-react-lightbox/",
    "toggl-cli/",
  ],
  sandbox: e2bSandbox({
    template: mempalTemplate("codex"),
    lifetimeMs: 60 * 60_000,
  })
    .setup(mempalSetup("codex"))
    .teardown(mempalTeardown("codex")),
  agent: codexAgent({ skills: [mempalSkill] }),
  sandboxReuse: true,
  maxConcurrency: 1,
});
```

`sandbox.template` 是无 Environment Eval 的默认起点。
它不是与 Eval 竞争的 Experiment Base。

当前 `mempalSetup("codex")` 检查预装 CLI 与 embedding cache,再恢复或初始化 memory state。
缺失时在 Agent 前失败并提示构建锁定 template;template 名本身不作为命中证明。

当前 `mempalTeardown("codex")` 在 Sandbox 收尾时回存 checkpoint。
这段状态语义与 Environment 起点正交;PLAN-6 保留现有写法,不借环境模型重造 state API。

## 运行路径

```text
Eval 没有 Environment source
  -> E2B SandboxSpec 默认 mempal template
  -> SandboxSpec mempal setup 检查命中或补齐
  -> workspace baseline
  -> EvalDef setup checkout repository
  -> EvalDef setup 安装 yarn dependencies
  -> Agent setup
  -> Agent turn
  -> turn 后 hidden verifier 与评分
  -> Sandbox 收尾时回存 mempal checkpoint
```

baseline Experiment 使用公共 Codex template,不追加 mempal setup、skill 或 state。
两组 Experiment 选择完全相同的 Eval,所以题目准备不随实验分叉。

某条 Eval 后续需要自己的 Compose 时,它开始声明或由 adapter 派生 Environment source。
同一 Experiment 下只有该 Eval 改走 materializer 或 `environments[profile]`;其它 Eval 继续使用默认 E2B template。
