# Table primitive 的列/行 key 校验只长在渲染面函数体内,纯 resolve/validate 断言够不着

**现象**:测试体系重划 A4(`src/report/runtime/dual-render.test.tsx`)把全部渲染断言收窄成纯
resolve/validate 断言时,`Table` 组件"列 key 重复报错""cells 出现未声明的 key 报错"这两条校验
无法照办——用 `resolveReportTree` + `validateReportTree` 走一遍,校验根本不会触发,唯一能让它报错
的路径是调用 `renderNodeToText`(或 web 面)。

**根因**:`src/report/definition/primitives.tsx` 里 `validateTableProps(props)` 是一个模块内私有
函数,只在 `Table` 的 `web()` 与 `text()` 两个渲染面函数体**开头**各调用一次,不在任何 `resolve`
钩子里执行,也没有单独导出。`Grid` 的等价校验(`validateGridColumns`)则相反——已导出且有自己的
`src/report/definition/grid-layout.test.ts` 直接测,不依赖任何渲染面。两个姊妹校验函数当前处于不
对称状态。

**修法**:A4 范围内不能改 `src/report/definition/primitives.tsx`(文件范围限定为两个测试文件),所以
把这两条 Table 校验测试保留为**唯一**允许残留 `renderNodeToText` 调用的例外——断言对象仍是抛出的
`Error`,不是渲染出的字符串内容,在文件头注里显式记录了这条例外与理由。真正的根治需要生产代码改动:
参照 `validateGridColumns` 的先例,把 `validateTableProps` 提出去做具名导出(或者挪进 `resolve` 阶段
执行),然后可以在专门的 primitives 单元测试里直接调用,不再需要触发渲染。这个改动超出 A4 范围,留给
后续touch `primitives.tsx` 的 Agent。
