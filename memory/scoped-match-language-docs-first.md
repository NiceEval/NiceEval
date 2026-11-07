# scoped 断言匹配语言:契约以 docs 为准,不从源码反推

- **裁决**(2026-07-14):`eventsSatisfy(label, predicate)`——label 必填、在前;`calledTool` / `notCalledTool` 的 `input` 是匹配小语言:对象做深度部分匹配(写出的键值要求出现且相等,未写的忽略,嵌套递归;值位置可放 `RegExp`),顶层 `RegExp` 匹配序列化后的完整输入,谓词函数拿原始值。契约落点:`docs/feature/scoring/library/scoped-assertions.md`、`docs-site/zh/concepts/assert.mdx`(后者本来就是这么写的)。
- **曾选方案**:commit 5b12736 给 scoped-assertions.md 补参数形状时从源码抄形态——`eventsSatisfy(predicate, label?)`、`input` 写成「浅层包含,非深度相等」,并在 commit message 里把 docs 原有的 `(label, predicate)` 判成笔误。
- **否决理由**:本仓库 docs 先行(docs/README.md 开篇:docs 是实现工作的输入,不是当前代码的说明书),源码形态落后于契约时应改代码而不是改文档。设计上也是 label 必填更优:谓词是断言词汇里最不透明的一个,无名失败在报告里读不懂;label 在前符合 `it(name, fn)` 的测试框架惯例,多行箭头函数收尾也更顺。深度部分匹配 + RegExp / 谓词逃生舱是更好的作者 DX,浅层包含对嵌套 input 过脆。
- **落实**:commit `c215076` 已将 `src/scoring/scoped.ts` / `src/context/types.ts` 对齐为 `(label, predicate)` + 深度部分匹配。下游 eval 需在升级后跑 typecheck 迁移旧参数顺序;运行时也应在记录断言时直接报迁移错误,不要留到 finalize 才暴露模糊的 `predicate is not a function`。
