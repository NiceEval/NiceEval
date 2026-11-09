# 用 Plugin 复用记忆条件

## 用户目标

记忆基准要用同一个记忆工具去比较多个 Agent。作者希望把记忆工具的 skill、状态目录和 cohort 装进一个值，每个 Experiment 只写一行就能挂上这个记忆条件。

## 起始状态

- 项目里有 `codex.ts` 与 `claude.ts` 两个不带记忆条件的对照 Experiment，都选择同一组 Eval Group。
- 本页未实际运行，输出均为预期输出。

## 完整路径

1. 把 State 与 Agent skill 装进 Plugin。 {#define-plugin}

   ```ts
   const mempalState = defineState({
     name: "mempal",
     version: "0.9.0",
     paths: ["~/.mempal"],
     initialize: shell({ command: "mempal init ~/.mempal" }),
   });

   export const mempal = definePlugin((options: { cohort: string }) => ({
     name: "mempal",
     key: options.cohort,
     identity: { version: "0.9.0", cohort: options.cohort },
     requires: { evalGroup: true },
     agent: { skills: [{ kind: "local", path: "./skills/mempal" }] },
     state: [mempalState.bind({ cohort: options.cohort })],
   }));
   ```

2. 在每个变体 Experiment 上挂载。 {#mount}

   ```ts
   export default defineExperiment({
     ...codexBaseline,
     plugins: [mempal({ cohort: "2026-11" })],
   });
   ```

3. 运行两个变体。 {#run}

   ```sh
   niceeval exp codex-mempal claude-mempal
   ```

   ```text
     state mempal · react-hook-form  initialized (no checkpoint for cohort 2026-11)
   ```

   两个 Experiment 的 lineage 不同，各自积累，不会读到对方的记忆。

## 结果

记忆条件在一个地方定义，Experiment 之间只差挂载的 Plugin。Plugin 的 `identity` 与 State binding 都进入条件身份，改动记忆条件会在 `--dry` 中显示为条件变化。

| 情形 | 结果 |
| --- | --- |
| Plugin 挂在 Eval 上 | 加载期拒绝：Eval 挂载点不接受 `state` |
| 同一 Experiment 自己也声明了 `name: "mempal"` 的 State | 加载期 `state-duplicate` |

## 相关契约

- [State Library · 与 Plugin 组合](../library.md#与-plugin-组合)
- [Plugins Library](../../plugins/library.md)
