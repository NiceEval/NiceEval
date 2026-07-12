---
name: report-component-data-fn-spyon-must-target-component
description: report 组件的 .data 是 Object.assign 装配时按值拷贝的，vi.spyOn 源模块拦不住经组件属性发起的调用
metadata:
  type: project
---

**现象**：`vi.spyOn(compute, "experimentListData")`（spy 源计算模块的具名导出）拦不住
`ExperimentList.data(selection)` 这条调用路径——断言"这个计算函数被调用了几次/带什么参数"
会静默失败或读到 0 次调用，即使组件确实渲染出了正确数据（数据本身没错，只是 spy 没生效）。

**根因**：`src/report/components.tsx` 用 `Object.assign(defineComponent({...}), { data: experimentListData })`
装配每个组件——这是模块初始化时对函数**值**的一次性拷贝，不是引用间接层。`vi.spyOn(compute, "experimentListData")`
替换的是 `compute` 模块自己的具名导出绑定，但 `ExperimentList.data` 属性上挂的是初始化那一刻拷贝过去的
原始函数引用，两者此后互不相干；经 `ExperimentList.data(...)` 或 `built-ins/cost-pass-rate-comparison.tsx`
内部调用发起的调用永远走的是未被替换的原始函数。

**修法**：要断言"某个 report 组件的 data 计算被调用"，spy 必须直接打在组件对象自己的属性上——
`vi.spyOn(ExperimentList, "data")`,不是 `vi.spyOn(compute, "experimentListData")`。这条对
`EvalList`/`AttemptList`/以及其它挂 `.data` 的双面组件同样成立。与
[report-build-rootdir-and-module-identity](report-build-rootdir-and-module-identity.md)是同一批
`Object.assign` 组装模式暴露出的第二个坑,后者是编译期身份问题,这条是测试期 mock 目标问题。
