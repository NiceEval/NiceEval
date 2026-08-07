# 在独立 Sandbox 审查最终仓库

## 解决什么问题

代码任务的质量不能只靠 diff 文本判断。
裁判需要打开最终仓库、追踪调用关系并运行针对性测试，同时不能污染被测 Agent 留下的现场。

## 全流程

Experiment 使用一个 Sandbox Agent 完成任务，并为 Agent Judge 声明另一套独立运行环境。

```ts
// experiments/coding.ts
import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { dockerImageSandbox } from "niceeval/sandbox";

export default defineExperiment({
  agent: codexAgent({ apiKeyEnv: "SUBJECT_OPENAI_KEY" }),
  sandbox: dockerImageSandbox({ image: "niceeval-agents:node24" }),
  judge: {
    agent: {
      agent: codexAgent({ apiKeyEnv: "REVIEWER_OPENAI_KEY" }),
      model: "gpt-5.4",
      reasoningEffort: "high",
      sandbox: dockerImageSandbox({ image: "niceeval-agents:node24" }),
      timeoutMs: 15 * 60_000,
    },
  },
});
```

Eval 显式授权裁判读取最终 workdir 副本。

```ts
// evals/fix-session-race.eval.ts
import { defineEval } from "niceeval";

export default defineEval({
  description: "修复 Session 并发关闭时丢失最后一条事件的问题",
  async test(t) {
    await t.send("修复 Session 并发关闭时丢失最后一条事件的问题，并补最小回归测试。");

    t.sandbox.fileChanged("src/session.ts");

    t.judge.agent(
      {
        name: "并发修复质量",
        criterion: "实现是否修复根因、保持 Session 生命周期不变量，并用有效测试覆盖竞争窗口？",
        anchors: [
          { score: 0, description: "未修复竞争条件，或以延时和重试掩盖问题" },
          { score: 0.5, description: "主路径可用，但仍有未封口窗口或测试不能稳定证明修复" },
          { score: 1, description: "修复根因，生命周期边界清楚，测试能稳定放走旧实现并接受新实现" },
        ],
      },
      { workspace: "snapshot" },
    ).gate(0.8);
  },
});
```

Runner 封口被测 send 窗口后捕获 workdir，再把副本导入全新的裁判 Sandbox。
裁判可以运行测试并修改自己的副本；原 workdir、被测 diff 与被测 Sandbox 的 retention policy 保持不变。

裁判返回的 evidence 可以引用 `src/session.ts:88`、测试文件和具体命令结果。
读取面把这些引用挂在 Agent Judge execution 下，不把裁判产生的新 diff 算给被测 Agent。

## 契约连接

- `workspace: "snapshot"` 的合法组合见 [Library · 默认材料与工作区](../library.md#默认材料与工作区)。
- 文件树复制规则见 [Architecture · workdir 快照](../architecture.md#workdir-快照)。
- 创建、导入与清理顺序见 [Lifecycle · Sandbox Agent Judge](../lifecycle.md#sandbox-agent-judge)。
