---
format: concord.document/v1
id: reasonfor-priority-and-severity-bug
title: MetricTable expand / CaseList / DefaultReport failing board 的失败原因曾各写一套 `.find(a => !a.passed)`,优先级还是错的
createdAt: 2026-07-11T22:34:32+08:00
createdAtSource:
  kind: first-recorded
  path: memory/reasonfor-priority-and-severity-bug.md
  commit: f98713aea9dc23b459ffa428b5cb32c56b438a4a
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修 [reasonfor-priority-and-severity-bug](reasonfor-priority-and-severity-bug.md) — `MetricTable` 展开子行、`CaseList.data`、`<DefaultReport />` failing board 曾各写一份 `.find(a => !a.passed)`,优先级还是断言先于 error、不查 skipReason、soft 断言混进失败原因;提炼成 `compute.ts` 的 `reasonFor`/`failingGateAssertions` 三处共用(修在 `src/report/compute.ts` + `official-report.tsx`)"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# MetricTable expand / CaseList / DefaultReport failing board 的失败原因曾各写一套 `.find(a => !a.passed)`,优先级还是错的

**现象**:`niceeval show` / `niceeval view` 里,一道题同时挂着 `error` 和失败断言时,`MetricTable` 展开子行、`<DefaultReport />` 的 failing board 有时显示的是断言名而不是 `error`(`official-report.tsx` 的 `buildBoard()` 甚至先找断言、找不到才落回 error,优先级整个反了);多个 gate 断言失败时只显示第一条,其余静默丢失;soft 断言失败会被当成失败原因显示出来(soft 只该影响得分,不该冒充"为什么失败");`skipReason` 从未被检查过,skipped 子行永远显示不出跳过原因。`CaseList.data` 的 `failedAssertions` 同样不分 severity,把失败的 soft 断言也列进"为什么失败"清单。三处口径互相不一致,同一个 attempt 在 show 和 view 上讲不出同一个故事。

**根因**:`src/report/compute.ts` 的 `reasonFor()`(仅 `subRows()` 用)只挑第一条 `!a.passed` 的断言(不分 gate/soft),挑不到才落回 `error`,从不检查 `skipReason`;`caseListData()` 里另有一份独立的 `.filter(a => !a.passed)`,同样不分 severity;`official-report.tsx` 的 `buildBoard()` 又有第三份内联逻辑,同样断言优先、`error` 兜底,且拼接文案用 `${severity} ${name}` 而不是 `name: detail`。三处各写一遍"怎么从 result 里挑出失败原因",一改就漏改另外两处。

**修法**(2026-07-11):在 `src/report/compute.ts` 提炼两个公开纯函数——`failingGateAssertions(result: EvalResult): AssertionResult[]`(只保留未通过的 gate 断言,原始声明顺序)与 `reasonFor(result: EvalResult): string | undefined`(优先级 `error` → `skipReason` → 未通过 gate 断言用 `, ` 拼接,每条 `detail` 在场是 `"name: detail"`、否则只有 `name`;soft 断言永不进入)。`subRows()`、`caseListData()`、`official-report.tsx` 的 `buildBoard()` 全部改call这两个函数,删掉各自的内联 `.find`/`.filter`。放在 `compute.ts`(而不是 `src/shared/`)是因为它只被 `src/report/` 内部消费(`official-report.tsx` 本就 import `compute.ts`),不像 `src/shared/verdict.ts` 那样需要被 server 与 `src/view/app`(独立打包的前端)两边同时 import——顺带发现 `src/view/app/lib/verdict.ts` 已经有一份手写的、格式完全一致的 `reasonFor`(独立实现,因为那是另一个打包边界,不能跨界 import `src/report/`),印证了 `error → skipReason → gate 断言 "name: detail" 用 ", " 连接` 是这个仓库里已经定下来的口径,不是本次臆造。

回归测试:`src/report/report.test.ts`(`MetricTable.data · expand` 和 `CaseList.data` 两个 describe 块新增用例)、`src/report/dual-render.test.tsx`(新增 `<DefaultReport /> failing board · 原因优先级` describe 块,走完整 `renderReportToText` 管线)。改动前跑过一遍确认全部按预期失败(旧 bug 复现),改完全部转绿。副作用:`src/report/report.test.ts` 里一条已有断言 `"gate-check — expected 2, got 1"`(em dash)和 `src/show/show.test.ts` 里一条 `'fileChanged(...) — file was not modified'` 都是旧格式的快照式期望,一并改成新的 `"name: detail"` 冒号格式。
