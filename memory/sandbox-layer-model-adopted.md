# 环境模型定稿:SandboxLayer 配对 XOR 与逐 Attempt prepare

## 裁决

2026-08-01,环境模型采纳 PLAN-10:Eval 与 Experiment 用同一个可选 `sandbox` 字段声明 `SandboxLayer`,每个实际配对恰好一方 template-bearing,顺序固定为 template owner → 另一 owner → Agent,普通 command 只有逐 Attempt 的 `prepare()` 一种频次。定稿契约在 `docs/feature/sandbox/layers.md` 与 `docs/feature/sandbox/lifecycle.md`,完整理由在 `docs/design/environment-model/DECISION.md`。

命名同批裁决:弃用 PLAN-10 文中的 root layer / extension layer,并回 GOALS / CASES 已用的 template 词族(template-bearing / command-only / template owner)。root 与命令选项 `root: true` 一词两义,`sandbox.root-conflict` 读起来像权限错误。

## 曾选方案

- PLAN-9(2026-07-31 曾定稿并关闭契约):同一内核,但普通 command 分 Window 与 Attempt 两种 scope,复用靠 reset anchor 跳过窗口 setup。
- PLAN-4 / PLAN-11(Requirement / Base Case / Ensure 族,见 [[requirements-base-case-ensure]]):通用 Requirement 集合加依赖资源调度图加融合 case 表。

## 否决理由

- PLAN-9 的 scope 选择在默认 fresh 模式下无症状,开 `sandboxReuse` 后才以复用污染或准备缺失爆发;检查成本两案都要付,scope、reset anchor 与 `windowStackIdentity` / `opaqueWindowSalt` 那片身份规格只有 PLAN-9 要付。reset anchor 声称能恢复两方 setup 的变化,但 workdir reset 恢复不了 workdir 外污染,「无法恢复即退休窗口」的判据本身不可判定。
- Requirement 族违反 GOALS 定稿原则(不建通用 Environment contribution、不自动推导依赖调度)与 LIMITS(融合走「一侧改用融合 template」,不新建 pair override 表);C10 要求缺 template 报 missing 而不是默认 case 补位。

## 连带影响

- 部分替代 [[reuse-once-setup-supersedes-idempotent-hooks]]:workdir reset 与 `sandboxReuse` 显式 opt-in 不变,但「一次装好、题间不重跑准备」改为「每 Attempt 重放 prepare,昂贵动作靠真实检查快速命中」;SandboxSpec Hook 链不再是公开面。
- 替代 [[sandbox-lifecycle-hooks]] 与 [[eval-environments-map-replaces-resolver]] 的作者面:SandboxSpec、`.setup()/.teardown()` Hook 链与 `environments` profile 表由 layer 声明取代;第一阶段没有 profile registry。
- 2026-08-01 追加两条连带裁决:EvalDef 不设 setup / teardown 字段(题目准备归 Eval layer `prepare()` 与 `test(t)`,清理走 `onCleanup`);phase 改记 `sandbox.prepare` / `sandbox.cleanup`,Agent Ensure 独立记 `agent.provision`。
