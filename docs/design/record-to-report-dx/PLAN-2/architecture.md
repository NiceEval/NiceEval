# PLAN-2 Architecture

## 生命周期

```text
open one frozen Record session
          ↓
apply caller selection and establish AnalysisSession
          ↓
run report.load(analysis)
  read + calculate with ordinary async TypeScript
          ↓
freeze returned model and close Record session
          ↓
render fixed Pages independently
          ↓
expand Families and render instances independently
          ↓
build Downloads independently
          ↓
immutable ReportExecution
```

Loader 可以串行、并行或有条件地调用 AnalysisSession。底层 Attachment read 仍可按 frozen snapshot、owner
与 family 缓存，因此同一物理 Attachment 不必重复读取。Host 不缓存 callback 的任意中间表达式。

## 错误边界

Record open、permission、closed session 与 interruption 是整个 execution failure。Attachment 六态进入
rows，作者自行决定 model 怎样保留它们。

Loader throw 或 rejected Promise 是 report-level execution problem。Host 没有 partial model，因而不能
继续渲染任何 Page。Loader 成功后，Page、Family、instance 与 Download 仍分别隔离。

这种粗边界是候选的核心取舍，不通过隐藏 try/catch 改写。作者可以在 loader 内主动把错误保存成 model
union，但这不是 host 能强制的一致语义。

Loader 是 trusted Node callback。它技术上可以 import filesystem/network；host 只管理 Record I/O 与
reader scope，不阻止也不追踪 ambient I/O。普通 async TypeScript 的自由不是安全或可复现性保证。

## 依赖与动态页面

依赖不在首次 I/O 前静态闭合。它们由 loader 控制流决定，但始终发生在同一 frozen session 内。PageFamily
不能再次读取 Record；它只从 model 展开 durable instance keys。

这允许“先读索引再决定读哪些 Attachments”，但不能绕过 RecordAttachment 自身完整 blob closure 的读取
规则。大型 trace 的一个 Attachment 仍会全量进入内存。

## Record 充分性

Run/Member/Attempt 与 owner-local Attachments 足以实现 selection、aligned rows、metrics 与 grading claims。
候选没有发现必须修改 durable Record 的新需求。

跨 Attachment subject identity migration 与大型 blob 选择性读取仍是 Record 层压力点。普通 loader 只让
控制流更自由，不增加 reader capability。
