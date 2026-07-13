# ⚡ niceeval 设计文档

`docs/` 描述 niceeval **已经定稿、希望产品最终满足的状态**。它是实现工作的输入，不是当前代码的说明书。

因此：

- 文档中的 API、CLI、目录或行为可以先于代码存在。
- 代码与文档不一致时，默认动作是让代码实现文档，而不是把文档改回当前代码。
- 文档正文不写“已实现 / 未实现 / 目前代码还是 / 之后再做”等实现状态。
- 只有设计本身改变时才改契约；实现进度、变更审计和历史过程不改变契约措辞。

要判断设计落到了哪里，使用 [Source Map](source-map.md) 定位源码并直接检查实现。要记录实现踩坑或设计翻案，进入 [`memory/INDEX.md`](../memory/INDEX.md)。

## 按意图进入

| 现在要做什么 | 从哪里开始 |
|---|---|
| 建立产品心智 | [Concepts](concepts.md) → [Architecture](architecture.md) |
| 从零理解使用路径 | [Getting Started](getting-started.md) |
| 设计或修改一个用户功能 | [Feature](feature/README.md) → 对应功能目录 |
| 讨论尚未定稿的方向 | [Roadmap](roadmap/README.md) |
| 设计仓库自身的测试、维护或 benchmark | [Engineering](engineering/README.md) |
| 从契约找到实现 | [Source Map](source-map.md) |
| 查过去的坑或被否决方案 | [`memory/INDEX.md`](../memory/INDEX.md) |
| 写公开用户文档 | [`docs-site/AGENTS.md`](../docs-site/AGENTS.md) |

## 目录索引

索引只列入口。进入某个二级目录后，从它自己的 `README.md` 继续发现正文。

```text
docs/
├── README.md                            本入口与写作契约
├── getting-started.md                   新手路径
├── source-map.md                        目标契约 → 源码落点
│
├── feature/                             已定稿的目标功能契约
│   ├── _template/                       新功能文档模板
│   ├── adapters/                        连接 AI / Agent；各 SDK 契约见 adapters/sdk/
│   ├── eval/                            编写 Eval：defineEval
│   ├── experiments/                     组织运行配置：defineExperiment
│   ├── sandbox/                         隔离运行环境
│   ├── scoring/                         评分器与判定
│   ├── results/                         .niceeval 运行产物、读写与搬运
│   └── reports/                         show、view 与报告组件
│
├── roadmap/                             尚未定稿的功能设计
│   ├── multi-agent/                     多 Agent Eval 场景
│   └── view-enhancements.md             View 的候选增强
│
├── engineering/                         仓库自身的工程机制
│   ├── _template/                       新工程主题模板
│   ├── unit-tests/                      单元测试:谁要测、谁不测
│   ├── e2e-ci/                          全链路 E2E
│   ├── benchmark/                       阶段耗时与安装 benchmark
│   └── example-tier-sync/               示例同步机制
│
└── 暂未归入 feature/ 的设计入口
    ├── concepts.md                      术语与心智模型
    ├── architecture.md                  核心边界
    ├── origin-integration.md            Origin 应用接入
    ├── capabilities-by-construction.md  能力由构造证明
    ├── observability.md                 Observability
    ├── runner.md                        执行引擎
    ├── cli.md                           CLI 内部架构
    └── references.md                    外部设计参考
```

## 文档的唯一归属

写之前先判断内容是什么：

| 内容 | 归属 |
|---|---|
| 已裁决的目标功能、API、CLI、语义与架构理由 | `docs/feature/` 或 `docs/` 对应设计页 |
| 尚未裁决、仍存在开放分歧的候选设计 | `docs/roadmap/` |
| 仓库自身如何测试、维护、同步或 benchmark | `docs/engineering/` |
| 用户如何完成任务 | `docs-site/zh/` |
| 设计翻案、被否决方案、踩坑与反直觉修法 | `memory/` |
| 本次修改了什么、为什么 | commit message |

同一事实只在一个入口完整定义。其它页面用链接建立关系，不复制一份容易漂移的规则。

## 写目标状态

每一段都应让从未读过旧稿的人独立理解最终契约。

- 用声明句写产品应当是什么、输入输出是什么、错误如何反馈。
- 可以写稳定理由，例如为什么使用组件树；理由帮助约束实现。
- 不写时间线或差分句，例如“之前是”“现已改为”“删除 X 后”“新版不再”。
- 不在正文保留“要不要”“再议”等开放问题。未裁决内容留在 Roadmap 或对话中。
- 设计变化时重写受影响小节，不在旧段落后追加修正说明。
- 不用当前类型或当前输出反向限制目标设计。示例展示的是期望 API 与期望反馈。

Feature 文档具体怎样拆成 `README.md`、`library.md`、`cli.md` 与 `architecture.md`，由 [`feature/README.md`](feature/README.md) 和模板定义。Engineering 文档的组织方式由 [`engineering/README.md`](engineering/README.md) 定义。

## 从设计到实现

一次设计迭代按以下顺序完成：

1. 在对话中裁决分歧；未裁决内容不写进 Feature 契约。
2. 先按目标状态重写 `docs/`；涉及公开任务路径时同步 `docs-site/zh/`。
3. 修改代码，使实现满足契约。
4. 按 [Source Map](source-map.md) 和对应功能入口核对相关实现、测试与公开文档。
5. 有翻案或反直觉修法时写入 `memory/` 并更新索引；本次变更原因写进 commit。

文档先于实现并不表示可以留下永久漂移。目标一旦定稿，后续工作应以完成实现和验证为终点。

## 校验与同步

修改 `docs/` 或根 README 后运行：

```sh
pnpm test
```

`test/docs-consistency.test.ts` 检查索引覆盖与相对链接。新增设计页必须从本索引或所属二级目录的 `README.md` 可发现。

如果设计同时改变公开 API、CLI、结果格式或用户任务路径，还要沿对应入口完成同步：

- 公开参考区块：修改源码 TSDoc / CLI flag JSDoc 后运行 `pnpm docs:reference`。
- 公开中文文档：按 [`docs-site/AGENTS.md`](../docs-site/AGENTS.md) 更新并运行 `docs:validate`、`docs:links`。
- 示例：按 [`examples/README.md`](../examples/README.md) 与对应示例目录说明验证。
