# Weights & Biases：Models 与 Weave

> 观察日期：2026-08-14
>
> 观察对象：W&B Models 与 W&B Weave 两套原生产品面
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

W&B 公开站点同时提供 [Models](https://docs.wandb.ai/models) 与 [Weave](https://docs.wandb.ai/weave)。
两者共享账号、entity 与 project 名。
Models 的 Run 链与 Weave 的 Call 链使用不同写入对象、本地文件、服务端结构和读取 API。
`wb_run_id` 只提供跨产品引用，不能把两条链合成一个 schema 或一个 reader。

## 产品身份

[W&B Models](https://docs.wandb.ai/models) 是 ML practitioner 的 system of record。
它跟踪实验、版本化数据集与模型，并在同一 App 里比较与协作。

一次计算单位是 **Run**。
[`wandb.init()`](https://docs.wandb.ai/models/ref/python/functions/init) 打开 Run。
`run.log()`、`run.config`、`run.summary`、`wandb.Table` 与 `wandb.Artifact` 往该 Run 写事实。
同一产品再用 Workspace、Report 与 [`wandb.Api()`](https://docs.wandb.ai/models/track/public-api-guide) 读取。

[W&B Weave](https://docs.wandb.ai/weave) 是 LLM 与 agent 的 observability 与 evaluation 平台。
它跟踪函数与 agent 步骤，版本化 prompt / model / data，并收集 Feedback。

官方给出两条 Weave 工作流，不要混成一条。
见 [What is Weave?](https://docs.wandb.ai/weave/concepts/what-is-weave)：

1. **Trace an Agent**：按 OpenTelemetry 与 GenAI conventions 看 session、turn、LLM call、tool call。
2. **Instrument functions as Ops**：用 `@weave.op` 跟踪任意函数。

`wb_run_id` 可以把一条 Weave Call 挂到某次 Models Run。
这是跨产品引用，不是同一张表。
机制分别见各研究页，不要从这一句推断联合 schema。

## 用户心智模型

### Models

一次训练或计算对应一个可 resume 的 **Run**。
用户用字典式 key 往这个 Run 上追加事实。
App 再按 key 自动出图。

组织轴是 **entity → project → run**。
[Run 概览](https://docs.wandb.ai/models/runs) 写明：身份是项目内唯一的 run ID；显示名可以改，也不必唯一。
不指定 project 时，Run 进入 `Uncategorized`。

它不是 sealed revision，也不是内容寻址的对象图。

### Weave

函数或 agent 步骤变成 versioned **Op**。
每次执行变成 **Call**。
共享 `trace_id` 的 Call 树是 **Trace**。

评测是「一份 **Evaluation** 蓝图 × 一次 `.evaluate()` Call」。
**Feedback** 是另一条可事后写入的平面。

这与 Models「一次训练一个 Run、往上 log 键」不是同一模型。
见 [Ops, Calls, and Traces](https://docs.wandb.ai/weave/guides/tracking/tracing) 与 [Evaluations](https://docs.wandb.ai/weave/guides/core-types/evaluations)。

## 原生对象总图

### Models

```text
entity / project
    └── Run  (id, name, state, config, history, summary, files)
            ├── Artifact  (name + type + checksum → vN)
            ├── Table     (作为 artifact 持久化)
            ├── Sweep / Launch  (可先创建 Pending Run)
            └── Workspace / Report / Runset  (读时选择与构图)
```

### Weave

```text
entity / project
    ├── Op          versioned 函数
    ├── Call        一次执行；树构成 Trace
    ├── Object      Dataset / Model / Prompt / Evaluation / SavedView
    ├── Table/rows  按 digest 存行
    └── Feedback    挂在 weave_ref 上
```

`weave:///{entity}/{project}/{kind}/...` 是用户空间 ref。
内部存储用 `project_id` 与 `weave-trace-internal:///`。
见 [weave.md](weave.md) 与 [storage.md](storage.md#weave)。

## 研究页导航

| 页 | 只回答什么 |
|---|---|
| [layers.md](layers.md) | 各产品自己的 layer / component / resource、owner、引用与依赖 |
| [execution.md](execution.md) | 发起、调度、执行、写入、完成、失败、partial、retry / resume |
| [storage.md](storage.md) | type / class、table / model、file / directory、envelope / API resource |
| [reading-and-comparison.md](reading-and-comparison.md) | 重开、query / filter / align / group / compare / render、缺测 |
| [schema-and-migration.md](schema-and-migration.md) | schema 轨道、兼容 reader、migration、升级、是否改已存数据 |
| [weave.md](weave.md) | Weave 独立产品面、与 Models 的边界、SDK / ClickHouse / migration 证据索引 |

各页按 Models 与 Weave 分节，不互相复制同一段。

## 与 NiceEval 的相似点与差异

对照不把 W&B 改写成 Record → Analysis → Report。

### 相似点

- 用户代码真实运行，同一产品再查询和展示，而不是先落盘再外接 BI。
- Models 普通作者默认只写中立键；自动图是读侧面的增强。
- Weave 把执行（Call）与评价（Feedback / scorer Call）分开查看。
- Artifact 与 Weave Object 都用 checksum / digest 升版。
- Weave `row_digest` 按内容对齐评测行。
- Models 报告可以冻结 Runset。
- SDK 破坏性变更有公开规则；Weave server 有编号 SQL migration。

### 差异

| 产品对象 | NiceEval 不宜直接类比的地方 |
|---|---|
| 可 resume 的 Run ID | 不是 sealed Attempt |
| config / history / summary 全局键 | 不是 owner-local RecordAttachment |
| 可改已结束 Run 的 summary / config | 不是不可变 Claim |
| `history(samples=500)` 与 `NaN` | 没有穷尽 coverage |
| Weave Call 可只有 start；Feedback 可 purge | 不是固定 revision |
| 服务端 Models 存储闭源 | 没有用户可见的 `migrate` plan |
| Models 与 Weave 两套信封 | 不是同一 Record graph |

### 可吸收约束

1. 普通作者只看到一层写入 API；展示可以后绑。
2. 身份、显示名、超参分开。
3. 客户端破坏性变更必须公开；服务端升级与用户事实 migration 必须分开。
4. receipt 保存 exact ref / digest，不要只写 latest。
5. 不要把采样视图或 `NaN` 当成完整事实。
6. 不要把 Weave Call 与 Models Run 合成一张表。
7. 本机 `wandb/` 与 `~/.weave/wal` 应对产品用户保持 opaque。

机制证据与未公开边界见对应研究页，不在本页展开。
