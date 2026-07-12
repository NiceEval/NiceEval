# ⚡ niceeval 文档索引

内部设计与实现协作文档的索引,全部用中文书写。产品定位与心智模型见 [Vision](vision.md)、[Concepts](concepts.md)、[Architecture](architecture.md);从零上手见 [Getting Started](getting-started.md);把设计行为定位到源码见 [Source Map](source-map.md)。

**功能文档**回答"niceeval 能做什么、怎么用",读者是用这个能力的实现者/用户侧协作者,一个功能一个子目录,物理归在 `docs/feature/`;**工程文档**回答"niceeval 这个仓库自己怎么被验证、维护、跑分",不是能力说明,物理归在 `docs/engineering/`。还没定为当前契约的功能提案物理归在 `docs/roadmap/`。仍有一部分功能文档暂时按文档类型平铺在 `docs/` 下,尚未拆进 `feature/`,见下方清单:

```text
docs/
├── README.md                            入口:项目定位 + 快速开始 + 本导航
├── getting-started.md                   新手向导
├── source-map.md                        设计行为 → 源码文件的映射表
│
├── feature/                             当前功能契约 —— niceeval 能做什么、怎么用
│   ├── README.md                        约定说明:一个功能一个子目录
│   ├── _template/                       新开功能子目录的起始模板
│   │   ├── README.md                    占位:功能说明
│   │   ├── cli.md                       占位:CLI 预期反馈
│   │   └── architecture.md              占位:架构
│   └── adapters/                        连 AI / 接 agent
│       ├── README.md                    定位与导航
│       ├── contract.md                  Adapter 契约(逐 API 适配义务)
│       ├── authoring.md                 Adapter 写法(递进式写法)
│       ├── collection.md                采集设计(三条外部路线对比)
│       ├── targets.md                   接入目标矩阵(12 个被测对象调研)
│       ├── coding-agent-skills-plugins.md   Coding Agent Skills / Plugins DX
│       └── reference/                   背景调研:其它项目怎么做的
│           ├── agent-eval.md            agent-eval 是怎么做适配的
│           ├── otel-genai.md            OTel GenAI「行为怎么记」标准
│           ├── agent-loop-apis.md       四个主流 agent loop 接入面调研
│           ├── otel-instrumentation.md  应用侧 OTel 埋点生态调研
│           ├── eve-protocol.md          eve 的协议机制
│           └── claude-code-otel-telemetry.md  Claude Code 自带 OTel 遥测调研
│
├── roadmap/                             还没定为当前契约的提案
│   ├── README.md                        约定说明
│   └── multi-agent/                     多 agent eval 的三种场景
│       ├── README.md                    功能说明:三种场景与目标 DX
│       ├── cli.md                       CLI 预期反馈
│       └── architecture.md              架构:事件流、能力位、采集可行性
│
├── engineering/                         niceeval 自身怎么被验证、维护、跑分
│   ├── tier-sync.md                     examples origin→tier 同步维护工具
│   ├── e2e-ci.md                        全链路 e2e 测试方案
│   └── phase-timings.md                 attempt 阶段计时与 sandbox × adapter 安装基准
│
└── 功能文档(暂平铺在 docs/ 下,逐步迁入 feature/) ── niceeval 能做什么、怎么用
    ├── vision.md                        心智模型:为什么叫 fast
    ├── concepts.md                      心智模型:术语表
    ├── architecture.md                  心智模型:核心边界
    ├── eval-authoring.md                写 eval
    ├── assertions.md                    断言参考(作用域 + 来源)
    ├── scoring.md                       评分器
    ├── origin-integration.md            Origin 应用接入手册(五个应用的接入记录)
    ├── capabilities-by-construction.md  能力由构造证明
    ├── sandbox.md                       Sandbox
    ├── observability.md                 Observability(含 OTel trace 瀑布图)
    ├── experiments.md                   跑与看:实验/运行矩阵
    ├── runner.md                        跑与看:执行引擎
    ├── cli.md                           跑与看:CLI 参考
    ├── results-format.md                跑与看:结果保存格式
    ├── results-lib.md                   跑与看:结果数据读写库 `niceeval/results`
    ├── reports.md                       跑与看:报告积木(指标 × 计算函数 × 双面组件)
    ├── view.md                          跑与看:本地查看器(报告槽 + 证据室)
    └── references.md                    背景调研:从其它项目学到什么
```

## 关于这些文档

这些是**内部设计与实现协作文档**:记录 niceeval 的目标 DX、架构边界和实现协作约定,全部用中文书写。[Source Map](source-map.md) 把设计行为定位到源码。功能文档([Feature](feature/README.md))先于代码定稿是正常流程,代码后续跟上;正文不写实现状态。未列入当前契约的提案放 [Roadmap](roadmap/README.md),同样只写"要什么、是什么"。
