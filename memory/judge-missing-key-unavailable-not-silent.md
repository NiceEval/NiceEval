# 设计裁决:judge 缺 key 记 unavailable,不静默消失

- **裁决**(2026-07-14):judge 没有解析到模型 / API key 时,该条断言记录为 `AssertionResult { unavailable: true, reason }`——soft 不参与得分但保留在记录里,`.gate()` 的 judge 使 attempt `errored`。同一 `unavailable` 态同时承载证据通道不完整时的负断言 / 上限断言(EvidenceCoverage,见 `docs/feature/adapters/architecture/evidence.md`)。契约落在 `docs/feature/scoring/library/judge.md`、`severity-and-verdict.md`、`scoring/cli.md`。
- **曾选方案:缺 key 时 judge 命名空间可调用但不记录断言,CI 自查 key 注入**。否决理由:用户写了关键 rubric,整条断言可以无声蒸发而 attempt 照样 passed——违反仓库自己在 selection warnings 与 evidence 里反复立的「缺口永远被算出来,不静默」原则;「从报告里有没有分数反推 judge 跑没跑」正是该原则要消灭的姿势。外部契约 review(2026-07-14)将其列为 P0 后翻案。
- ~~不另设 `.optional()`:「允许缺席」由默认 soft 表达~~ **同日被第二轮外部评审推翻**:soft 承担「允许缺席」会造成「soft judge 全评不了但 attempt 还绿着」的无测量绿。新裁决:所有断言默认要求可评估,任一非 optional 断言 unavailable → `errored`(不分 gate/soft);允许缺席显式 `.optional()`,与 severity 正交、不互相复用。已落 `severity-and-verdict.md` 与 `judge.md`。
