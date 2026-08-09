# Reports：把 Sample 变成可交付视图

Reports 把已经选择好的 [Sample](../sample/README.md) 变成终端输出、浏览器页面或可分享的静态报告站。它负责计算和呈现，不拥有评估事实。

    RecordReader → core-only Sample → ReportPlan
                                      ↓
                                  ReportInput
                                      ↓
                              ReportExecution
                                ↙           ↘
                              view          export

<code>ReportInput</code> 是进程内的普通值。它带着 core-only Sample、完整分母，以及按 ReportPlan 请求的 Run 与 Attempt 通道读取。它不落盘，不是另一种 Record 格式，也不携带打开的 reader。

## 核心心智

Sample 决定比较范围和分母。Reports 不按时间、路径或 Attempt locator 再选成员。一个分母项即使没有 Member、核心引用有误，或被调用方排除，也保留在 ReportInput 中，并以 Sample 的状态呈现。

只有 Record→Reports composition adapter 同时接收 reader、Sample 与 plan。Report 定义、Calculation、页面、本机 runtime 和静态 runtime 只消费 ReportInput 或一次形成的 ReportExecution，不重新打开 Record。

每个页面和 Calculation 都声明自己需要的 facts。未被该页面或 Calculation 请求的损坏、未知或退役通道不会阻断它。被请求的 invalid 通道形成该请求的失败；unavailable 与 unsupported 进入明确的呈现状态。

## 计算与完整度

Calculation 必须同时声明：

- 所需的 facts；
- 分母如何采用 Sample 的 slot；
- <code>allowPartial</code> 或 <code>requireComplete</code> 完整度 policy；
- 可用、部分和不可用状态怎样呈现。

例如 <code>commands.checked</code> 只在 100 个分母项中的 20 个被采集时，页面写 <code>20 / 100 · partial</code>。它不能把 20 当成 100。选择 <code>requireComplete</code> 的同一读数是 unavailable，不给出假装完整的数值。

完整规则在 [Calculations](calculations.md) 定义；公开类型在 [Library](library.md) 定义。

## 页面与静态分享

一个 Report 先用纯 <code>plan()</code> 枚举所有页面、参数化页面实例、Calculation、Download 和各自 inputs，再形成 ReportInput。<code>executeReport()</code> 让每个 custom parser 和 consumer 各执行至多一次；show、view 与 export 消费同一份既有结果。

静态 export 是一个自包含目录。它包括预渲染页面、当前宿主数据、下载项、exporter 内建的精确 runtime，以及穷尽的 <code>StaticAssetManifest</code>。用户 Report 不提供任意浏览器脚本、CSS 或路径 loader。浏览器只从该目录读取 artifact 私有数据；它不访问网络、源 Record 或未来安装的 NiceEval。

参数化页面必须在 export 前穷尽实例。目标目录必须不存在；成功时同级临时目录以一次 rename 完整出现。固定 <code>manifest.json</code> 不列入自身 entries，除此之外每个文件都必须被 manifest 穷尽。

## 范围

Reports 包含：

- 从 core-only Sample 与 ReportPlan 形成 ReportInput；
- 一次执行 Calculation、Page 与 Download，并由 view/export 共用结果；
- 声明 facts、Calculation、页面、文本与网页呈现；
- 对 partial、unavailable、unsupported 和 invalid 的可读反馈；
- 终端查看、本地浏览和自包含静态分享；
- 可访问的页面结构与文字等价内容。

Reports 不包含：

- Record 文件读取、写入、格式定义或通道 decoder；
- 事实 owner、proof、snapshot、revision 或任何 Record 引用；
- Record-to-Record 复制、镜像、同步或观察文件变化；
- 全局 custom fact registry 或 capability negotiation。
- 任意浏览器资源 provider 或用户路径读取。

## 入口

- [Architecture](architecture.md)：边界、输入流程、通道隔离、静态 export 与不变量。
- [Library](library.md)：ReportInput、facts、Calculation、页面和静态 export 的公开形状。
- [CLI](cli.md)：<code>show</code>、<code>view</code> 和 <code>view --out</code>。
- [Calculations](calculations.md)：完整度 policy、分母和报告旁算法。
- [Use case](use-case/README.md)：比较、完整度核对、静态分享和可访问页面。
- [Reference](reference/README.md)：外部材料的使用边界。
