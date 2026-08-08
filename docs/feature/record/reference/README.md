# Record —— 参考方案

这一层的形状不是原创。
下面逐条记下**从谁那里学的什么**,以及**哪些地方有意没跟**。
读法:决定「为什么是这个形状」时看这里,决定「现在是什么形状」时看 [Architecture](../architecture.md)。

## Allure —— 事实目录 + 独立生成器

**是什么。**
Java 生态的测试报告框架。
各语言测试框架的 adapter 往 `allure-results/` 里写一堆 JSON,`allure generate` 是完全独立的进程,读这些 JSON 产出 HTML 站点。

**学了什么。**

- **格式与生成器分离,而且格式在前。**
  adapter 只需要认识文件格式,不需要 link 任何渲染代码。
  这正是 `.niceeval/` 与 `niceeval/report` 的关系,也是 [`createWriter`](../library.md#写createwriter)敢把写入面开放给第三方 harness 的依据——Allure 的 adapter 生态(JUnit / pytest / Jest / Cypress …)实证了这条路走得通。
- **一次运行一个目录,不写聚合文件。**
  通过数、失败数由生成器从逐条事实推导,不落盘。

**没跟什么。**

- **Allure 的 results JSON 长期没有版本字段**,靠隐式兼容,adapter 与 generator 版本错配是它的常见 issue 类型。
  Record 把 `format` / `schemaVersion` / `producer` 定为[永久稳定的三字段](../architecture.md#版本与升级设计),并且**不做迁移**:版本不同就提示用产出它的版本打开。
  这是直接冲着这个坑设计的。
- Allure 的 tab 集合固定(Overview / Categories / Suites / Graphs),报告不可编程。
  呈现层的可编程性是 [Reports](../../reports/README.md) 的目标,参考物在那一层的 reference 里。

## Git object alternates —— 借用与悬空

**是什么。**
Git 允许一个仓库通过 `.git/objects/info/alternates` 借用另一个仓库的对象库:本地不存那些对象,读的时候去 alternate 路径找。
`git clone --shared` 就是这么省磁盘的。
被借的仓库一旦被删或 gc,借用方的对象**静默不可达**——Git 社区反复警告这一点。

**学了什么。**

- **借用的形状。**
  [携带条目](../library.md#携带条目与-evidencestate)的 `artifactBase` 就是 alternates:条目在新 Run 里,artifact 的字节还在原 Run 目录。
  省的是同一份 events / trace /源码不被复制 N 遍。
- **复制成自包含结果是唯一的正解。**
  Git 的答案是 `git repack -a`(把借来的对象打进自己的包),[`publish()`](../library.md#发布publish) 做的是同一件事:解开引用,把 artifact 复制进目标 Run,使复制出的内容自包含。
  两边遵守同一条纪律:离开原仓库前先把外部引用指向的内容复制进目标目录。
- **`git clone --shared` 的文档明确写「除非你知道自己在做什么,否则不要用」。**
  同样的判断落成`.niceeval/` 是本地事实根、跨出可信边界必须经 `publish()`。

**没跟什么。**

- **Git 让悬空静默,Record 不。**
  这是有意做得比 Git 好的一处:`attempt.evidenceState` 的`"dangling"` 态把「借来的东西没了」变成可判断的数据,而不是一个说不清原因的`null`。
  理由是 Record 同时还有一个 `artifacts` 列表在声明「写过什么」,两者不对齐时必须有人说出哪边是真的。

## Git object database —— 内容寻址去重

**是什么。**
Git 按内容的 SHA 存 blob,同样内容只存一份,路径与内容分离。

**学了什么。**
[`sources/<sha256>.json`](../architecture.md#sourcesjson) 是同一个设计:attempt 级`sources.json` 只存 `{path, sha256}` 引用,内容进 Run 级去重仓库。
一个 eval 文件被多个 attempt、多次重试引用是常态,按**内容**而不是按**路径**去重,重试与数组默认导出的多个 eval 天然合并。

**没跟什么。**
不做 packfile、不做 delta 压缩、不做 gc。
这些落盘的生命周期以周计,不是以年计;为省磁盘引入一个需要维护的对象库,代价大于收益。

## dbt —— 事实层与派生层分家

**是什么。**
数据转换工具。
源表(sources)不可变,模型(models)是从源表算出来的派生物,`target/` 里的 `run_results.json` / `manifest.json` 是每次运行留下的落盘。
materialization 策略(view / table / incremental)是**显式声明**的,不是隐式缓存。

**学了什么。**

- **派生物删了可重算,是一条能守住的纪律。**
  Record 里唯一的落盘派生物是[`o11y.json`](../architecture.md#o11yjson),定位写死为「缓存不是权威」,与 `events.json` 不一致时以 `events.json` 为准。
- **不预聚合。**
  通过数、成本合计这类聚合永远在消费方算,不落盘——同一条铁律。

**没跟什么。**
dbt 的 materialization 有三档可选,Record 现在只有「不落」与「落一个明确标记为缓存的文件」。
规模变大后如果需要更多档位,应该像 dbt 一样做成显式声明,而不是悄悄多几个派生文件。

## Observable Framework —— 取数与渲染在时间上分离

**是什么。**
静态站点生成器。
data loader 是独立可执行脚本(任何语言),**构建时**运行,输出写成静态文件;页面只 `FileAttachment("x.json")` 读,渲染时不碰数据源。

**学了什么。**
`niceeval view --out` 的静态导出是同一个模型:artifact 复制成静态文件,查看器只 fetch,不需要任何服务端。
`publish()` 收 Sample，就是为这条带完整性上下文的路径设计的。

**没跟什么。**
Observable 的 loader 每次构建重跑,Record 的事实是 `niceeval exp` 一次写成、之后不可变。
这不是取舍不同,是两种数据的性质不同:eval 跑一次要花真金白银,不能当成可以随时重算的派生物。

## 相关阅读

- [Architecture](../architecture.md) —— 这些取舍落成的格式规范。
- [Library](../library.md) —— 落成的 API。
- [Sample 的参考方案](../../sample/reference/README.md) —— 选择层与转换算子从哪里学。
- [Reports 的参考方案](../../reports/reference/README.md) —— 组件层与双渲染面从哪里学。
