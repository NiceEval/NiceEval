# view Attempt 详情:断言区落地 + 时间树默认收合

> **已被 `plan/report-pages-attempt-detail-alignment.md` 取代。** 本文件把 attempt 详情当作 `src/view/app/components/AttemptModal.tsx` 内部要修的一块内容;新契约下详情内容整体迁出 view,变成 `niceeval/report` 公开的 `AttemptDetail` 组合组件与 11 个叶子组件(见 `docs/feature/reports/library/attempt-detail.md`),`view` 只保留 page 寻址与 dialog 摆放。本文件提到的断言区优先、时间树默认收合等具体行为要求仍然成立,但落点已经不是 `AttemptModal.tsx`,而是新组件族的 web 面实现——执行时请对照 `report-pages-attempt-detail-alignment.md` 第 7 节(Phase C)。

## 背景

契约 `docs/feature/reports/view.md`「Attempt 详情」要求断言区(failed / unavailable 先展开、每条失败直接显示 matcher、expected / received 或 reason、passed 按 group 折叠计数、源码锚),且时间树 children 默认收合。当前 view 实现两者都没有:断言只以代码视图行内锚存在(点行才展开),`PhaseTimingBlock` 无条件全展开压满首屏。来龙去脉与根因见 `memory/view-attempt-detail-buries-failure.md`。

场景已登记:`docs/engineering/unit-tests/reports/cases.md`「Attempt 详情(view 证据室)」四行。测试方法(纯渲染、`<details>` 表达折叠态、静态 markup 断言)见 `docs/engineering/unit-tests/reports/README.md`「view 证据室的观察面」。

## 改动点

全部落在 `src/view/app/`,数据契约(`ViewResult.assertions` / `phases`)不变。

1. **断言区组件**(新增,放 `components/`):
   - 输入 `result.assertions`,不等 artifact 加载——渲染位置在 `AttemptModal` 内容区顶部、`PhaseTimingBlock` 之前(判定徽章在标题栏,已有)。
   - failed(gate)、unavailable、未达标 soft 逐条默认展开:显示 matcher/name、groupPath、expected / received(缺则 reason)、evidence 折叠块(复用 `CodeView.tsx` 的 `AssertDetail` 单条渲染,或从它提炼共用);每条带源码锚,`href` 指向代码视图对应行的元素 id(代码行需要加 `id`,锚点滚动到行)。
   - passed(含达标 soft)按 group 收进 `<details>` 折叠区,summary 显示数量;无 group 的归一个默认组。
   - 没有 assertions 的 attempt(纯 errored)不渲染空区块。
2. **时间树默认收合**:`PhaseTimingBlock` / `TimingRow` 的 children 改用原生 `<details>`(summary = phase 行),默认不带 `open`;失败最深节点保留 ✗ 标记,祖先不重复标。收尾段分组保持现状。
3. **纯渲染边界**:把 `AttemptModal` 里的 artifact fetch 移出渲染组件(提炼 hook 或上移到调用方),使弹窗内容组件对 props 纯渲染,单测可用 `renderToStaticMarkup` 直接断言。
4. **测试**:实现 cases.md 该分区四行,一行一测,放 `src/view/app/components/` 旁(如 `attempt-detail.test.tsx`),fixture 直接构造 `ViewResult`;文件头注释按惯例标 `// cases: docs/engineering/unit-tests/reports/cases.md`,并加 `// bug: memory/view-attempt-detail-buries-failure.md`。

## 验证与收尾

- `pnpm run typecheck`;`pnpm test`(新测试 + docs/memory 一致性)。
- **`pnpm run view:build`** 重建 `src/view/client-dist/`(不做这步本地 view 看不到变化,见 memory 先例)。
- 真实 repo 冒烟:在 `/Users/ctrdh/Code/coding-agent-memory-evals` 跑 `pnpm exec niceeval view`,打开一个失败 attempt,核对首屏即见失败断言的 expected / received,时间树只占主链几行。
- 同步义务:grep `docs-site/zh/guides/debugging.mdx` 等页对 Attempt 详情的描述,与契约不一致处按中文文档规范同步。
