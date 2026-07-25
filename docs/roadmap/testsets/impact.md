# Testsets —— 对既有契约的影响面

这份提案定稿时，既有文档各要改成什么。列在这里是为了让裁决前就能看见代价：测试集不是一个孤立的新功能，它落在 eval id、发现、选题、快照可比性和术语这几条已经定稿的契约上。

按「改动性质」分三类：**术语**要先裁一次词，**契约**要重写受影响小节，**新增**是提案自带的新页面。

## 一、术语：两个词各自撞车

### 「测试集」现在归 Dataset

[Concepts](../../concepts.md) 的术语总表把 `Dataset` 的中文写作「测试集」，同一页的分区标题与正文又写「数据集」——这个词本来就在两处不一致。这份提案要用「测试集」指 Testset，两件事一起裁：

| 词 | 定稿后的中文 | 含义 |
|---|---|---|
| Dataset | 数据集 | 共享同一 `test` 逻辑、只有输入不同的一组 case，`.map` 扇出 |
| Testset | 测试集 | 可分发的一包 eval，自带 id 命名空间与内容指纹 |
| Benchmark | 跑分卷 / benchmark | 从若干测试集里挑出的题集 + 榜单，agent 无关 |

落点：`docs/concepts.md` 总表加三行（Testset / Benchmark / 内容指纹），Dataset 那行中文改「数据集」，`### 测试集与发现` 分区标题与 `## 数据集与发现` 正文小节统一，`docs-site/zh` 与 `examples/zh` 里指 Dataset 的「测试集」措辞跟着改。

### 「benchmark」现在归性能基准

`docs/engineering/benchmark/` 指的是阶段耗时与安装耗时的性能基准，与用户概念的跑分卷同名。两个意思不能共用一个裸词，[分歧 5](README.md#待裁决分歧) 要裁：给用户概念留 `Benchmark`、工程那篇改称「性能基准 / perf benchmark」，还是给用户概念换词。裁决之前，本提案正文按前者书写。

## 二、契约：受影响的既有页面

| 文档 | 改什么 |
|---|---|
| [`concepts.md`](../../concepts.md) | 术语总表加 Testset / Benchmark / 内容指纹三行；Dataset 中文改「数据集」；`niceeval.config.ts` 字段表加 `testsets`（该表声明为穷尽形状，不加就是「没有这个字段」）；「发现」词条加测试集来源 |
| [`runner.md`](../../runner.md) | 「发现」小节：扫 `evals/` 之外还要扫各引用测试集的 `evals` 目录、加命名空间、查碰撞、合并排序；`benchmarks/` 与 `experiments/` 对称发现；benchmark 选题表达式的求值时点 |
| [`cli.md`](../../cli.md) | 模块地图加 `testset` 分支（只读路径，不进 Effect 调度核心，与 `list` 同层）；`exp` 数据流里加 benchmark 解析与 `pin` 校验的位置 |
| [`architecture.md`](../../architecture.md) | 「保持 core 中立」补一句：测试集是数据，不是新的路由维度；测试集不能提供 agent / sandbox / reporter |
| [`feature/eval/README.md`](../../feature/eval/README.md) | 「**禁止**提供 `id` / `name`」那段要说清例外只开在测试集自己的 `id` 上，测试集内部的路径推导规则不变 |
| [`feature/eval/library.md`](../../feature/eval/library.md) | 「命名与组织约定」加一条：题可以来自测试集，id 多一段命名空间；「tags 与 environment」补 `testset` 也是 experiment / benchmark 谓词可读的来源事实 |
| [`feature/experiments/README.md`](../../feature/experiments/README.md) | `EvalDescriptor` 加 `testset?: string`；`defineExperiment` 加 `benchmark?: BenchmarkDef` 并声明与 `evals` 互斥；同型约束改成「benchmark 或 evals 选中的题必须同型」 |
| [`feature/experiments/library.md`](../../feature/experiments/library.md) | `evals` 谓词小节加 `e.testset` 的用法与「不要用 `id.startsWith` 判断来源」的理由；补一段「选题搬到 benchmark 之后 experiment 只剩跑法」 |
| [`feature/experiments/architecture.md`](../../feature/experiments/architecture.md) | Resolved config 一节：benchmark 不引入新的解析层（它只贡献选题），但如果[分歧 4](README.md#待裁决分歧) 裁为测试集可带运行缺省，这条链要加一层并定死顺序 |
| [`feature/results/architecture.md`](../../feature/results/architecture.md) | `ExperimentRunInfo` 加 `benchmark` 与 `testsets` 两个投影字段，并按「新增公开运行配置字段必须同步进这张投影」的既有纪律声明归属 |
| [`feature/results/library.md`](../../feature/results/library.md) | 可比性配置字段清单加测试集 `contentHash` 与 benchmark 指纹（归「会改变单题被测行为或判定」那一类）；说清它们与 `selectedEvalIds`（选题字段，不参与比较）的分界 |
| [`feature/sandbox/library/prebuilt-environments.md`](../../feature/sandbox/library/prebuilt-environments.md) | `environments` 表加一段：profile 需求可能来自测试集；`environmentHints` 是推荐值而非默认值，摊开才生效 |
| [`feature/reports/library/metrics.md`](../../feature/reports/library/metrics.md) | 维度全集加 `testset` 与 `benchmark`。现有 `evalGroup` 取 id 的父路径，对测试集题会算出 `swe-memory/recall` 这类混了来源的组——来源要有自己的维度，不能靠 id 切片 |
| [`feature/reports/README.md`](../../feature/reports/README.md) | 报告装载顺序：`benchmark.report` 插在 `--report` 与 `config.report` 之间；跨版本卷面在榜单上如实分列的呈现契约 |
| [`feature/results/README.md`](../../feature/results/README.md) | 若[分歧 7](README.md#待裁决分歧) 裁为支持跨团队榜单，搬运能力要加「导入别人的快照」这个来源 |
| [`error-feedback.md`](../../error-feedback.md) | 新增几类错误（缺环境映射、id 碰撞、`pin` 不匹配、`benchmark` 与 `evals` 并存）按既有规则各带下一步，不新立反馈体裁 |

## 三、新增：提案自带

| 文档 | 内容 |
|---|---|
| `docs/feature/testsets/`（定稿后从 roadmap 整篇搬入） | README / library / cli / architecture 四篇 |
| `docs/feature/testsets/use-case/` | 至少三篇：用别人的测试集跑自己的 agent、把自己的题发成测试集、同一张卷跨 agent 对比 |
| `docs/engineering/testing/unit/testsets.md` | 覆盖规范：id 命名空间与扇出、碰撞报错、`contentHash` 的确定性（同内容异机同值）、benchmark 指纹对 `description` / `report` 变化不敏感、`pin` 校验、`benchmark` 与 `evals` 互斥、`environmentHints` 不隐式生效 |
| `docs-site/zh/` | 两篇任务文档（用别人的测试集 / 发布自己的测试集）+ 参考页的 `defineTestset` / `defineBenchmark` / `config.testsets` 区块；英文入口按中文同步 |
| `examples/zh/` | 一个可运行示例：一个本地测试集包 + 引用它的 benchmark 与两个 experiment |

## 四、实现期要盯的两条既有纪律

这两条是仓库 `CLAUDE.md` 点名的历史事故类型，本提案正好各踩一个：

- **`EvalDescriptor.testset` 是给共享接口加可选字段。** 它跨发现、benchmark 谓词、experiment 谓词、快照投影、报告维度多个消费点，类型系统一次都拦不住漏填。加它的那次改动要做调用点普查（消费点 grep **旧**字段名 `EvalDescriptor` 的构造处），并配一条真跑「测试集题 + 本地题混在一份发现结果里按来源过滤」的行为测试——只有同时有两类来源的 fixture 才有区分力。
- **`report` 的来源从两处变三处。** `--report` → `benchmark.report` → `config.report` 是一条新的 `??` 链，解析顺序必须先在文档里定死，配一条「config 有默认报告 + benchmark 也声明了报告」的区分力测试。特别检查兜底层有没有被提前物化：把 `config.report` 的缺省提前塞进解析结果，`benchmark.report` 那一层就永远短路，症状是「卷子自带的榜单不生效」。

## 相关阅读

- [README](README.md) —— 三层分工与待裁决分歧。
- [Architecture](architecture.md) —— 指纹与数据形状，本页多数改动的依据。
- [`docs/README.md`](../../README.md) —— 一次设计迭代的落文档顺序与同步义务。
</content>
