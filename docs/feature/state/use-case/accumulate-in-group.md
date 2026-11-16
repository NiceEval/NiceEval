# 在一组题里积累记忆

## 用户目标

记忆基准的作者想证明：Agent 带着记忆工具做一组相关的题时，后面的题能用上前面的题留下的记忆；下一次运行还能从这次结束的地方接着积累。

## 起始状态

- `evals/react-hook-form/` 下有 6 个 Eval，并由 `evals/react-hook-form/eval-group.ts` 组成一个 Eval Group。
- Sandbox 镜像里已经装好 `mempal`，数据目录是 `~/.mempal`，不在 Eval workdir 内。
- 本页未实际运行，输出均为预期输出。

## 完整路径

1. 定义 State 并绑定到 Experiment。 {#bind}

   ```ts
   const mempal = defineState({
     name: "mempal",
     version: "0.9.0",
     paths: ["~/.mempal"],
     initialize: shell({ command: "mempal init ~/.mempal" }),
   });

   export default defineExperiment({
     evals: ["react-hook-form/"],
     agent: codexAgent(),
     model: "gpt-5.6-luna",
     sandbox: dockerSandbox({ source: { type: "image", image: "memorybench-codex:1" } }),
     state: [mempal.bind({ cohort: "2026-11" })],
   });
   ```

2. 预览起点。 {#dry}

   ```sh
   niceeval exp codex-mempal --dry
   ```

   ```text
     state mempal · react-hook-form  cohort 2026-11 · no checkpoint (initialize)
   ```

3. 第一次运行。Group 的 Sandbox 建成后执行 `initialize`，6 道题依次在同一台 Sandbox 上运行，Sandbox 退役时保存。 {#first-run}

   ```sh
   niceeval exp codex-mempal
   ```

   ```text
     state mempal · react-hook-form  initialized (no checkpoint for cohort 2026-11)
     ...
     state mempal · react-hook-form  saved sha256:3f9a…c21e (1.4 MB)
   ```

4. 从本次运行的结果取得第 4 道题的 locator，将下例 `@ATTEMPT-FOUR` 替换为实际值，再查看状态起点。 {#show-origin}

   ```sh
   niceeval show @ATTEMPT-FOUR
   niceeval show @ATTEMPT-FOUR --json
   ```

   ```text
     State   mempal  cohort 2026-11 · initialized · 3 earlier attempts in this sandbox
   ```

5. 再运行一次，同一 Group 从上次保存的 checkpoint 起步。 {#second-run}

   ```sh
   niceeval exp codex-mempal
   ```

   ```text
     state mempal · react-hook-form  restored sha256:3f9a…c21e (1.4 MB)
     ...
     state mempal · react-hook-form  saved sha256:91be…07d4 (2.1 MB)
   ```

   绑定 State 的 Attempt 不从上一次 Run 携带结果，不会因历史结果而跳过题目；选择范围、预算、early exit 与取消仍然生效。

## 结果

每次运行的每道题都能追溯到状态起点：从哪份 checkpoint 恢复，或从空状态初始化；以及同一台 Sandbox 上之前已有几道题进入并结束 Agent 阶段；计数不证明写入成功。

| 情形 | 结果 |
| --- | --- |
| 某道题超时，Agent 命令树无法证明已终止 | 该 Sandbox 退役，`save skipped`；替代 Sandbox 从原 checkpoint 起步 |
| `~/.mempal` 写成了 workdir 内的路径 | 能静态判断时在规划期报 `state-path-in-workdir`；远端路径在删除前拒绝 |
| 选中的 Eval 不属于任何 Eval Group | 规划期 `state-requires-eval-group` |

## 相关契约

- [State Library](../library.md)
- [State CLI](../cli.md)
- [State Architecture](../architecture.md)
- [Eval Group 生命周期](../../eval-groups/architecture/lifecycle.md)
