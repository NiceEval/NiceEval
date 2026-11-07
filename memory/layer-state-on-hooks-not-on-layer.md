# 设计裁决:层状态挂 spec Hook 链,不做层自带 state: { load, save }

**裁决**(2026-07-31,环境层 roadmap 评审):状态(记忆载入/回存这类每沙箱动作)留在 sandbox spec 的 `.setup()/.teardown()` Hook 链;`defineLayer` 不加 `state: { load, save }` 成对声明。同批判据当时落在 `docs/roadmap/environment-model/README.md`;当前候选快照见 `docs/design/environment-model/PLAN-2/architecture.md`。

**曾选方案**:层自带 `state: { load, save }`,让「mempal 的安装」与「mempal 的状态」在同一声明里成对出现(用户当时倾向此方案再评一轮,理由是成对声明更内聚、防漏挂状态 Hook)。

**否决理由**(空层测试):

1. **纯状态条件不该被迫写空层。** CLAUDE.md 记忆文件、git checkpoint、DB 种子没有任何要安装的东西——状态长在层上,它们要么写 check/apply 皆空、identity 无物可填的退化层,要么让状态在 Hook 链保留第二个家,而「不开第二个家」正是同篇否决 eval 层轴的判据,不能对自己不适用。
2. **节奏堆叠。** 层已有 prepare(每 run)、check(每 attempt)、apply(按缺失)三种节奏,state 再加每沙箱一种,一个对象背四种生命周期,原语从「环境内容」膨胀成「环境 + 生命周期」。
3. **参数化污染身份。** 状态是实验参数化的(哪个记忆库、哪个条件),层刻意实验无关、跨 sandbox case 复用;绑定后层要按实验参数化,state 参数进不进 identity 立刻含混——记忆内容是被测变量,绝不能进 fingerprint。

**内聚的替代买法**:同一模块成对导出层与状态 Hook(`mempal.ts` 导出 `mempal` + `mempalLoadState` / `mempalSaveState`),约定成文在记忆对照用例。

同场连带裁决(非翻案,倾向确认后收敛进正文):全栈复检零 apply 跳过;`requires` 不收体积(归 Run 级共享准备预算);`contains` 不做且永不代替运行期 check;eval 轴不开 layers;prepare 走 `ctx.stageDir` 文件路径不走内存字节;复用窗口 `sandbox.window.id/seq` 落 facts、回存失败必发 `sandbox-state-save-failed` 诊断。
