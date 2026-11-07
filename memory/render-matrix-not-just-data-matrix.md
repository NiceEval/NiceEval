# render-matrix-not-just-data-matrix

组件测试注册表要求"两面都渲染"时,只测 attempt*Data() 返回值形状是弱化替代,必须真正调用 renderToStaticMarkup/renderNodeToText

`docs/engineering/testing/architecture/unit/reports.md` 第 249 行(Attempt 详情组件族非空/空证据矩阵)登记的场景原文是"零输出态断言两面都不产生可见节点,非零输出态断言两面都含预期字段"——这句话的主语是**两面渲染输出**,不是 data 函数返回值。

写 Phase C(11 个叶子组件)的测试时,我把这行注册表条目实现成了 11 个 `expect(attemptXData(evidence)).toBeNull()` / `.toEqual({...})` 断言,只验证了 `attempt*Data()` 的返回形状。`pnpm run typecheck` 与 `pnpm run build:report` 都绿,套件也全绿,但 11 个叶子里有 9 个(除 AttemptSummary、AttemptTimeline 外)的 web/text 渲染函数**一次都没有被真正调用过**——`.toLocaleString()`、`JSON.stringify` 递归、`buildForest` 的 parentSpanId 查找这类只在渲染时才执行的代码路径,类型检查和"能编译"完全遮蔽不了。

**Why**: 请 advisor 复核 Phase C 时指出这个盲区。data 层矩阵和渲染矩阵是两个不同强度的断言;前者证明"数据对不对",后者证明"渲染会不会崩"——注册表登记的是后者,实现时容易不自觉替换成前者(因为 data 层更好写、更快跑),而两次自查(typecheck/build/test 全绿)都不会暴露这个替换,因为它们都不会真正执行未被测试直接渲染过的组件函数体。

**How to apply**: 注册表场景描述里如果出现"渲染""可见节点""HTML/text 面"这类词,写测试时要真的构造两态 data、直接 `renderToStaticMarkup(<Component data={...} />)` 和 `renderNodeToText(<Component data={...} />, ctx)` 跑一遍,不能只断言 data 函数的返回值。写完后自问:这个测试有没有真正执行过组件的 `web`/`text` 函数体?如果答案是"只是类型层面兼容",就还没满足注册表要求的场景。修法见 `src/report/attempt-components.test.tsx`「渲染矩阵」describe 块(表驱动,每叶子空/非空两态各渲染一次两面,断言 HTML 与 text 里各含一个该叶子独有的标志字段)。

与 [test-budget-inverted-pyramid](test-budget-inverted-pyramid.md) 同一类问题的变体:那条讲测试预算该往哪类代码分配,这条讲同一行注册表场景,实现时容易悄悄降级成更弱的断言强度。
