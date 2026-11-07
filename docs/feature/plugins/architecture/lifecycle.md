# Plugins —— Lifecycle

挂载点决定作用范围，字段决定执行时机。Experiment 的作者 before 先执行；宿主 Plugin 再按 Experiment、EvalGroup、Eval 层级与数组顺序执行。
after 按实际激活顺序完全逆序，Plugin after 先于作者 after。

1. Run 至少有一条 fresh Attempt 时，执行 Experiment 作者 before 与 Plugin experiment.before。
2. 每条有 fresh Attempt 的 Group lane 执行 group.before，随后创建或借出 Sandbox。
3. 每条 Attempt 在题间 reset 后执行 owner layer 的 before DAG，其中包含 Plugin sandbox 元素。
4. 执行 attempt.before、Agent 安装与 before、测试、Agent after，再执行 attempt.after 与 layer after。
5. lane 的 Sandbox 与 Provider 收尾后执行 group.after。全部 Attempt 收尾后执行 experiment.after 与作者 after。

全部 carry 时不执行任何 Plugin Hook，也不创建 Sandbox。部分 carry 或只选部分 Group 成员时，只激活实际执行的范围。
Group Hook 属于 lane，replacement 不重新执行；Sandbox 字段属于每条 Attempt 的 Layer occurrence，replacement 后照常执行。

调用 before 前先计入已激活前缀；before 自身失败也会执行对应 after，未激活项不执行 after。任一 before 失败跳过其后的业务阶段。
宿主 after 失败仅追加 warning diagnostic，继续其余 after 与底层 finalizer。每个收尾回调取得独立 signal 与预算，不继承已耗尽的执行 deadline。
Agent 专用 after 保留工厂失败语义：失败使 Attempt 失败，仍执行其余 after 与 finalizer。

`debug <experiment> <eval>` 展示完整生命周期及实际 Action 顺序，并标明 Plugin 的 name 与 key。Sandbox 元素服从既有 DAG；数组序号只在依赖与 changeFrequency 相同时参与排序。

完整 selection 的 requires 与重复实例检查先于任何资源操作，也适用于将被 carry 的成员。
相同 Group 成员的 Sandbox 身份必须兼容；不能使用第一个成员的声明代表其余成员。
