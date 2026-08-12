# Cases

**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md)

| Case ID | 用户问题 | 固定输入 | 验收结果 |
|---|---|---|---|
| C1 | 打开并选择分析范围 | 一个 Record root；explicit 或 latest Run 选择 | 整次分析使用同一 frozen snapshot，返回完整 selected Runs 与 logical slots |
| C2 | 展示 Attempt 详情 | Assertions、Verdict、Score、source 分属多个 Attachments | 作者不手工按 slot join；built-in 与用户页面使用同一 API |
| C3 | 比较质量与成本 | Reference Members、缺失 Attempt、Pass/Score Evals 混合 | 分母由 selected Run 定义；数值携带 coverage、reasons 与 logical evidence |
| C4a | 显式共享一个指标值 | loader 或 query 明确把同一通过率交给 Overview 与 Download | 公式执行一次，两个 consumers 使用同一 immutable value |
| C4b | 自动共享一个指标依赖 | Overview、Download 引用同一个 shared query object；另有不依赖它的 Attempt 页 | host 按 object identity 执行一次；公式失败只阻断 Overview 与 Download，Attempt 页仍可交付 |
| C5 | 区分 lineage | selected Run 引用另一个 origin Run 的 Attempt | Run-owned 字段明确来自 selected 或 origin Run，不能静默选错 |
| C6 | 呈现坏数据 | Attachment 分别处于六种读取状态 | 未请求数据不影响结果；请求的数据状态可诊断且不冒充零值 |
| C7 | 生成动态详情页 | 每条 Assertion 有 durable entry identity | I/O 依赖先闭合；页面按 durable key 展开，数组下标不能充当 identity |
| C8 | 读取 historical grading | 多个 grading Runs 指向同一 execution Attempt | 调用者显式选择 claims，不自动选择 latest；subject lineage 可复核 |
| C9 | 查询自定义 Attachment | 第三方 family 与 typed payload | 作者能声明 owner、relation 与纯 typed view，不获得任意 reader callback |
| C10 | 分析脚本复用查询 | 同一查询既用于 Report 又用于非 UI 脚本 | 候选说明能否复用，以及脚本是否必须学习 Report 概念 |
| C11 | 读取大型 trace 的单个详情 | 一个 Attachment 含大量 blob chunks | 候选不得声称当前 reader 能选择性读取；必须暴露限制或提出独立 reader 变化 |
| C12 | 输出机器可读结果 | 一个指标同时需要页面与 JSON/CSV | 不从页面文本反推数值，也不重复公式 |
| C13 | 从物理采集包建立关系 | 同一 Attempt 有 OTel、agent events、commands、Assertions 等独立 packages | 单包 projector 不跨包；Relations 只用 durable anchors 建 relation，不按时间、文本或数组位置猜测 |
| C14 | 只查询物理包中的一个逻辑视图 | 一份 OTel package 同时可投影 spans、usage 与 timing | 语义视图不要求拆 durable family；当前完整 closure reader 限制被如实暴露 |

表格定义问题集合，不代表每个候选都必须满足。具体 fixture、可观察结果与候选状态见
[Evaluation](EVALUATION.md)。
