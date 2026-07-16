# view Attempt 详情把失败原因埋没:断言区缺失 + timing 树全展开压顶

## 现象

`niceeval view` 打开一个失败 attempt 的详情弹窗,首屏从上到下全是全展开的 timing 时间树(sandbox.queue / agent.setup / eval.run 及其全部 shell/turn 子行)加 usage 行;没有任何断言区块。要知道「为什么失败」,必须滚过时间树和整份 Eval 源码,找到代码视图里的红色行,再点击该行才展开 expected / received。契约(`docs/feature/reports/view.md`「Attempt 详情」)要求的断言区——failed / unavailable 先展开、每条失败直接显示 matcher、expected / received 或 reason、passed 按 group 折叠计数——在 view 里不存在。

## 根因

三次变更叠加,且没有任何测试拦截:

1. `26e967e` 把断言改成只在代码视图行内锚定(gutter 勾叉 + 点行展开),删掉了旧的分组断言视图——从此失败明细必须交互挖掘。
2. `792aae0` 在弹窗顶部插入统一时间树面板(`PhaseTimingBlock`),children 无折叠交互、无条件全展开,把代码视图(唯一的失败线索)压到首屏之外。
3. `74affaf` 定稿断言区契约(docs-first),但 view 侧实现从未跟上;`show` 有对应实现,view 没有。

脱节能存活的结构原因:view 证据室 App(`src/view/app/components/AttemptModal.tsx` / `CodeView.tsx`)没有 DOM 契约测试,`docs/engineering/unit-tests/reports/cases.md` 也没有 Attempt 详情的登记行——契约写了,没有场景行,实现 Agent 就不会为它写测试。

## 修法

- 测试方案(已落):`docs/engineering/unit-tests/reports/cases.md`「Attempt 详情(view 证据室)」分区四行 + `docs/engineering/unit-tests/reports/README.md`「view 证据室的观察面」——证据室按确定性渲染语义在单元层测 DOM 结构事实,折叠态用原生 `<details>` 表达使静态 render 可断言;不进 E2E 层。
- 实现修复(待做):`plan/view-attempt-detail-evidence-first.md`——补断言区组件、时间树 children 默认收合、artifact 拉取移出纯渲染组件;改完记得 `pnpm run view:build`(先例:codeview-perline-hidden-scrollbar-clips-text)。
