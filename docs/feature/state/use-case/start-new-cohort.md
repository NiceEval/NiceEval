# 换一个 cohort 从空状态开始

## 用户目标

调试期间记忆已经积累了很多杂乱内容。作者要做一轮正式对比，希望所有记忆条件都从空状态起步，同时保留调试期的 checkpoint 以便回看。

## 起始状态

- Experiment 绑定了 `mempal.bind({ cohort: "2026-11" })`，cohort `2026-11` 已有 checkpoint。
- 本页未实际运行，输出均为预期输出。

## 完整路径

1. 把 cohort 改成新的名字。 {#change-cohort}

   ```ts
   state: [mempal.bind({ cohort: "formal-2026-12" })],
   ```

2. 预览，确认从空状态开始。 {#dry}

   ```sh
   niceeval exp codex-mempal --dry
   ```

   ```text
     state mempal · react-hook-form  cohort formal-2026-12 · no checkpoint (initialize)
   ```

3. 运行。 {#run}

   ```sh
   niceeval exp codex-mempal
   ```

   ```text
     state mempal · react-hook-form  initialized (no checkpoint for cohort formal-2026-12)
   ```

## 结果

新 cohort 是一条新的 lineage，从空状态开始积累。cohort `2026-11` 的 checkpoint 原样保留；把 cohort 改回 `2026-11` 就从它当时的状态继续。cohort 写进每条 Attempt 的状态起点，报告可以按 cohort 区分这两批结果。

## 相关契约

- [State Library](../library.md#定义)
- [State Architecture · Lineage](../architecture.md#lineage)
