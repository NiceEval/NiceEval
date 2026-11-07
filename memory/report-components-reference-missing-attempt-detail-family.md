# `report-components.mdx`(中英文)完全不覆盖 attempt-detail 组件族

## 现象

`docs-site/reference/report-components.mdx` 与 `docs-site/zh/reference/report-components.mdx` 逐节列出了 `Table`/`ExperimentComparison`/`ScopeSummary`/`ExperimentList`/`EvalList`/`AttemptList`/`FailureList`/`MetricTable`/`MetricMatrix`/`MetricBars`/`Scoreboard`/`MetricScatter`/`MetricLine`/`DeltaTable`,唯独没有 `AttemptDetail`/`AttemptAssessment`/`AttemptSummary`/`AttemptAssertions`/`AttemptSource`/`AttemptFixPrompt`/`AttemptTimeline`/`AttemptConversation`/`AttemptDiagnostics`/`AttemptUsage`/`AttemptTrace`/`AttemptDiff` 这一整个组件族——`docs/feature/reports/library/attempt-detail.md` 是这十几个组件的设计契约唯一落点,但用户侧参考页从未写过对应小节。2026-07-23 在实现 `plan/report-scoring-attempt-detail-display.md`(计分制 attempt 详情展示)时发现:该 plan 给 `AttemptSummaryData`/`AttemptAssertionsData`/`AttemptSourceData` 新增了带 TSDoc 的公开字段(`totalScore`/`scorePointsEarned`/`scoreEntries`/`aborted`/`unreached`),但 `pnpm docs:reference` 对这些改动没有任何反应——不是漂移,是这整个组件族原本就不在参考页范围内。

## 根因

[docs-reference-script-excludes-report-package](docs-reference-script-excludes-report-package.md) 已经记过:`scripts/generate-reference.ts` 不覆盖 `niceeval/report` 的公开面,`report-components.mdx` 全篇是手写页面。这个页面自己确实写了 attempt-detail *之外* 的组件族,但从未有人把 attempt-detail 这十几个叶子补进去——不是生成器的锅,是这篇手写页面本身的覆盖缺口,和 [docs-site-en-report-components-stale-groupby](docs-site-en-report-components-stale-groupby.md) 记录的"内容写了但过时"是两类问题(那条是过时,这条是缺失)。

## 修法(未修,记录待后续处理)

给 `report-components.mdx`(先中文后英文)补一节 attempt-detail 组件族:公开组件表(职责/空证据)、`AttemptSectionProps<Data>` 的 spec/data 判别联合、11 个 `attempt*Data(evidence)` 签名、以及计分制专属字段(`totalScore`/`scorePointsEarned`/`scoreEntries`/`aborted`/`unreached`)。内容来源是 `docs/feature/reports/library/attempt-detail.md` 与 `docs/feature/scoring/library/display.md`,不是重新设计——纯粹是把已经定稿的契约誊一份到用户侧参考页。工作量接近从零写一整节参考文档,不是"顺手改一行",因此没有在计分制 plan 里顺手做,只记录留给下一个文档维护批次。
