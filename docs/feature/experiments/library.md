# Experiments —— 库用法

model/flags 怎么透传、实验怎么按文件夹组织成可对比组,以及和 `niceeval.config.ts` 的关系。核心契约见 [README](README.md)。

## model / reasoningEffort 与 flags:agent 留空,实验决定

agent 定义里**不写死模型、不写死开关**(那样就锁死了复用)。这几样由实验给,经 `ctx` 透传:

- **`model`** —— 单个模型字符串,agent 的 `send` 从 `ctx.model` 拿;省略则不传 `--model`,用 agent CLI 的原生默认。**跨模型对比写多个实验文件**(各钉一个 model),别在一个实验里塞数组。
- **`reasoningEffort`** —— 单个推理努力程度字符串(取值由具体模型定义,如 `"low"`/`"medium"`/`"high"`),归属与 `model` 完全一致:agent 的 `send` 从 `ctx.reasoningEffort` 拿,eval 的 `test` 从 `t.reasoningEffort` 拿;省略则用 agent 原生默认。跨档位对比同样写多个实验文件。
- **`flags`** —— 任意 KV 的参数,**两处可见**:agent 的 `send`(`ctx.flags`)、eval 的 `test`(`t.flags`)。用来开关联网、注入某个 skill、或让某条 eval 只在某个参数下断言。

```typescript
// experiments/research-mode.experiment.ts
export default defineExperiment({
  agent: codexAgent(),
  model: "opus",                                    // 模型在实验给,agent 留空
  reasoningEffort: "high",                          // → ctx.reasoningEffort / t.reasoningEffort
  flags: { webResearch: true, skill: "memory-v2" }, // → ctx.flags / t.flags
  runs: 3,
});
```

参数驱动的环境差异(比如按 `flags.skill` 往沙箱注入一个 skill 文件)写在 eval 的 `test(t)` 里:`if (t.flags.skill) await t.sandbox.writeFiles({ ".agent/skill.md": loadSkill(t.flags.skill) })`——普通代码,不需要框架钩子。

详见 [Adapter 契约:三类配置的归属](../adapters/contract.md#三类配置的归属本地配--实验传入--ctx-透传)。

## 实验怎么组织:文件夹 = 一组可对比的实验

experiment 借 next-evals-oss 的"一条件一文件",再用**文件夹**把"可比性"显式化:

```
experiments/
└─ compare/                  # 一组可对比实验:同一模型下 bub vs codex
   ├─ bub-gpt-5.4.ts         #   单一配置,文件名 = <agent>-<model>
   └─ codex-gpt-5.4.ts
```

- **文件夹 = 一组可对比的实验**;**同一文件夹下的文件才互相对比**。`niceeval exp compare` 跑整组,`niceeval view` 把同组并列。
- **文件 = 单一配置**(一个 agent × 一个 model 是最干净的情形),文件名按 `<agent>-<model>[-<feature>]` 命名。同组钉住对比轴之外的一切(如同一 model),差异才干净归因到那一个轴(agent / 记忆机制 / flags)。
- **路径即 id**:`experiments/compare/bub-gpt-5.4.ts` → `compare/bub-gpt-5.4`;目录段 `compare` 即组名。

### 一文件一配置

**一个实验文件 = 一个配置**(一个 agent × 一个 model)。要跨模型 / 跨 agent 对比,就**写多个实验文件**,各钉对照轴之外的一切(如同一 model),差异才干净归因到那一个轴。`model` 是单个字符串,不接受数组 —— 想扫多个模型,复制一份实验文件改 `model` 即可。

这样每个配置独立成文件:可命名(`<agent>-<model>[-<feature>]`)、可 diff、可单独 review,"这一组就是对照"这层意思在文件结构上就讲清楚了。两条配置汇总都按 `(agent, model)` 分组,可在 `niceeval view` 里并排。

### 例子

```typescript
// experiments/compare/bub-gpt-5.4.ts —— 对照组的一格:bub(tape on)
export default defineExperiment({
  description: "bub · gpt-5.4(tape on)",
  agent: bubAgent(),
  model: "gpt-5.4",        // 同组钉同一 model,差异归因到 agent / 记忆机制
  runs: 5,
  earlyExit: false,        // 要完整通过率分布(pass^k)
  budget: 15,
});

// experiments/compare/codex-gpt-5.4.ts —— 同组对照的另一格(只换 agent)
export default defineExperiment({
  description: "codex · gpt-5.4",
  agent: codexAgent(),
  model: "gpt-5.4",
  runs: 5,
  earlyExit: false,
  budget: 15,
});

// 想扫多个 agent/model 时,复制多个实验文件;不要在单文件里塞数组。
```

## 与 config 的关系

- **`niceeval.config.ts`(`defineConfig`)** = 项目级默认:`judge`、`reporters`、并发 / 超时、`pricing`、`sandbox`。`Config.sandbox` 必须是工厂函数产出的显式 `SandboxSpec`；experiment 的 `sandbox` 可以覆盖它。两处都没配置时，沙箱型 Agent 直接报错，不探测环境或选择内置 Provider 默认值。
- **`experiments/**/*.ts`(默认导出 `defineExperiment`)** = 一次具体运行的配置,覆盖 config 默认;按文件夹聚成可对比组(`.experiment.ts` 后缀可选,位于 `experiments/` 下即识别)。

调度项覆盖优先级(高 → 低):**CLI flag → experiment → config → 内置默认**。agent、model、flags 属于 experiment,不由 CLI 覆盖。

## 相关阅读

- [README](README.md) —— `defineExperiment` 的核心契约。
- [Architecture](architecture.md) —— 对照 agent-eval 砍了什么。
- [CLI](cli.md) —— `niceeval exp` 命令。
