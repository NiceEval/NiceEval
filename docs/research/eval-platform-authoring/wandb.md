# Weights & Biases：从用户代码写入到同一产品读取

> 观察日期：2026-08-13
>
> 观察对象：Weights & Biases Models 实验跟踪、Public API、Workspace 与 Report
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

本文把 W&B 当作一套完整平台：用户代码真实运行，Python SDK 写入 Run，同一产品再查询、比较并展示。
它不是外接 SQL 后再画图的 BI 工具。

正文区分三类陈述。
**产品事实**只采用官方文档、官方 SDK 源码、官方 GitHub 仓库与正式 migration 文档。
**研究判断**是对作者面与边界的归纳。
**NiceEval 建议**只供 Record → Analysis → Report 设计参考，不构成契约。

产品没有公开某能力时，只写「本次检查的一手公开面未提供」，不推断内部实现。

## 定位与真实边界

### 产品事实：W&B Models 是实验事实库

官方把 [W&B Models](https://docs.wandb.ai/models.md) 写成 ML practitioner 的 system of record。
它跟踪实验、版本化数据集与模型，并在同一 App 中比较与协作。

一次计算单位是 Run。
[`wandb.init()`](https://docs.wandb.ai/models/runs/initialize-run.md) 在用户进程里开始一次 Run。
`run.log()`、`run.config`、`run.summary`、`wandb.Table` 与 `wandb.Artifact` 把事实写进该 Run。
随后同一产品用 Workspace、Report 与 [`wandb.Api()`](https://docs.wandb.ai/models/track/public-api-guide) 读取。

这与外接仓库后再接 BI 不同。
写入面与读取面共享同一 Run 身份、同一 config / history / summary，以及同一 artifact lineage。

### 产品事实：Models 与 Weave 不是同一写入面

W&B 公开站点同时提供 Models 与 [Weave](https://docs.wandb.ai/weave.md)。
Weave 跟踪 LLM Op、Call 与 Trace，并提供 [OTLP 导入](https://docs.wandb.ai/weave/guides/tracking/otel.md)。

本文研究的是 Models 这条「用户脚本 → SDK → Run → Workspace / Report」路径。
Weave 的 OTel、Call schema 与 Feedback 不并入 Models 的 Run 契约。
下文提到 Weave 时，只用来标出产品边界。

### 产品事实：SDK、服务端、Report / Workspace API 的开源与稳定性不同

| 面 | 公开仓库或包 | 许可证 | 观察日稳定面 | 一手材料 |
|---|---|---|---|---|
| Python SDK | [`wandb/wandb`](https://github.com/wandb/wandb) `v0.28.2` | [MIT](https://github.com/wandb/wandb/blob/v0.28.2/LICENSE) | 开源、可固定 tag；破坏性变更走 [BREAKING.md](https://github.com/wandb/wandb/blob/v0.28.2/BREAKING.md) | 仓库 README、LICENSE、BREAKING.md |
| Report 与 Workspace 代码 API | [`wandb/wandb-workspaces`](https://github.com/wandb/wandb-workspaces) `0.4.5` | `pyproject.toml` 写 [Apache-2.0](https://github.com/wandb/wandb-workspaces/blob/main/pyproject.toml) | 官方与 README 均标 **Public Preview** | [创建报告](https://docs.wandb.ai/models/reports/create-a-report.md)、[仓库 README](https://raw.githubusercontent.com/wandb/wandb-workspaces/main/README.md) |
| 自托管服务端 | [`wandb/server`](https://github.com/wandb/server) | 仓库文本为 [MIT](https://raw.githubusercontent.com/wandb/server/main/LICENSE) | 仓库公开的是启动说明与 Docker 入口，不是应用源码 | [README](https://raw.githubusercontent.com/wandb/server/main/README.md) |
| 云端 App / 查询引擎 / 图面板 | 无对应应用源码仓库 | 本次检查的一手公开面未提供 | 滚动文档；部分面板标 beta | 官方文档站 |

`wandb/server` 的公开面是 `wandb server start` 与镜像 `wandb/local`。
[README](https://raw.githubusercontent.com/wandb/server/main/README.md) 要求从 [Deployer](https://deploy.wandb.ai/) 生成 license，并贴进本机 `/system-admin`。
生产能力（外部 MySQL、云存储、SSO）要另向 `contact@wandb.com` 申请。
本次检查的一手公开面未提供服务端存储格式、查询引擎或 App 源码。

`wandb-workspaces` 的 `pyproject.toml` 同时写了 `license = "Apache-2.0"` 与 classifier `License :: OSI Approved :: MIT License`。
本文只保存这一公开不一致，不裁决哪一条是法律真源。

### 观察边界

官方文档站 [`docs.wandb.ai`](https://docs.wandb.ai/llms.txt) 是滚动页面。
网页不能固定到 commit。
SDK 与 workspaces 库用 tag 固定。
文档陈述以 2026-08-13 读取的页面为准，并用固定 tag 核对签名。

`resume_from`、`fork_from` 官方标 beta。
`mode="shared"` 官方标 experimental。
Report 与 Workspace 代码 API 官方标 Public Preview。
`wandb sync` 正在迁到 `wandb beta sync`。

## 观察版本与一手材料

### 固定快照

| 对象 | 观察版本 | 固定点 |
|---|---|---|
| Python `wandb` | `v0.28.2`（2026-08-12 发布） | [GitHub tag](https://github.com/wandb/wandb/releases/tag/v0.28.2) · commit `dc1ef8b` |
| `wandb-workspaces` | `0.4.5` | [pyproject.toml](https://raw.githubusercontent.com/wandb/wandb-workspaces/main/pyproject.toml) |
| `wandb/server` | 观察日 `main` 上的 README / LICENSE；发布页列出 `0.83.0` | [仓库](https://github.com/wandb/server) · [Releases](https://github.com/wandb/server/releases) |
| 文档站 | 2026-08-13 滚动页 | [llms.txt](https://docs.wandb.ai/llms.txt) |

### 一手材料

后文 `S1` 至 `S24` 指向这里。

| 编号 | 官方材料 | 用途 |
|---|---|---|
| S1 | [`wandb.init` 参考](https://docs.wandb.ai/models/ref/python/functions/init) | Run 开始、`id`、`resume`、`mode`、`reinit` |
| S2 | [Initialize runs](https://docs.wandb.ai/models/runs/initialize-run.md) | 单进程、多 Run、`reinit` |
| S3 | [Run 概览](https://docs.wandb.ai/models/runs.md) | Run 身份、project、summary、config |
| S4 | [Run states](https://docs.wandb.ai/models/runs/run-states.md) | Finished / Failed / Crashed / Running / Pending / Killed |
| S5 | [Resume a run](https://docs.wandb.ai/models/runs/resuming.md) | `must` / `allow` / `never` / `auto` |
| S6 | [Configure experiments](https://docs.wandb.ai/models/track/config.md) | config 写入、事后更新、`pin_config_keys` |
| S7 | [Log overview](https://docs.wandb.ai/models/track/log.md) | `log`、系统指标、metric 命名 |
| S8 | [Log summary](https://docs.wandb.ai/models/track/log/log-summary.md) | `summary` 与 `define_metric` |
| S9 | [Customize log axes](https://docs.wandb.ai/models/track/log/customize-logging-axes.md) | 自定义 x 轴 |
| S10 | [Log tables](https://docs.wandb.ai/models/track/log/log-tables.md) | `wandb.Table` |
| S11 | [Log plots](https://docs.wandb.ai/models/track/log/plots.md) | `wandb.plot`、`plot_table`、matplotlib |
| S12 | [Custom charts](https://docs.wandb.ai/models/app/features/custom-charts.md) | Vega、GraphQL、historyTable |
| S13 | [Artifacts](https://docs.wandb.ai/models/artifacts.md) | `Artifact`、`log_artifact`、`use_artifact` |
| S14 | [Create an artifact version](https://docs.wandb.ai/models/artifacts/create-a-new-artifact-version.md) | `v0` / `v1`、checksum |
| S15 | [Public API](https://docs.wandb.ai/models/track/public-api-guide) | 查询、比较、事后改 config / summary |
| S16 | [Workspaces](https://docs.wandb.ai/models/track/workspaces.md) | 个人 workspace 与 Saved view |
| S17 | [Panels](https://docs.wandb.ai/models/app/features/panels.md) | 自动 / 手动 workspace |
| S18 | [Create a report](https://docs.wandb.ai/models/reports/create-a-report.md) | UI 与代码创建 |
| S19 | [Edit a report](https://docs.wandb.ai/models/reports/edit-a-report.md) | Runset 过滤、分组、冻结 |
| S20 | [Environment variables](https://docs.wandb.ai/models/track/environment-variables.md) | `WANDB_MODE=offline`、`WANDB_RESUME` |
| S21 | [`wandb sync` CLI](https://docs.wandb.ai/models/ref/cli/wandb-sync.md) | 离线上传与 clean 迁移 |
| S22 | [Server upgrade](https://docs.wandb.ai/platform/hosting/server-upgrade-process.md) | 服务端版本与 license |
| S23 | [SDK `Run.log` / `finish` / `define_metric`](https://github.com/wandb/wandb/blob/v0.28.2/wandb/sdk/wandb_run.py) | 固定源码签名 |
| S24 | [Public API `history` / `scan_history`](https://github.com/wandb/wandb/blob/v0.28.2/wandb/apis/public/runs.py) | 采样、缺测、system stream |

## 名词对照

| W&B 名词 | 本文中的准确含义 | 不宜直接当成的 NiceEval 词 |
|---|---|---|
| Run | 一次由 `wandb.init()` 打开、可 `finish` 的计算事实集合 | Record；Record 是已发布事实集 |
| Run ID | 项目内唯一身份；删除后不可复用 | Attempt identity |
| config | 输入与超参的字典式对象 | RecordAttachment schema |
| history | `log()` 追加的时间序列 | Analysis population |
| summary | 每个 key 的单值摘要，默认为最后一次 `log` | Analysis measure |
| Table | 列类型可含 media 的二维表；后端按 artifact 持久化 | Report component |
| Artifact | 具名、分 type、按内容 checksum 升版的文件集合 | RecordAttachment value |
| Workspace | 项目内探索 Run 的面板沙盒 | Report |
| Report | 可分享的叙事页，内含 panel grid 与 run set | `ReportData` |
| Weave | 另一套 LLM trace / eval 产品 | Models 的 Timing 或 Evidence |

## 1. Run 怎样开始、封口并形成稳定身份

### 产品事实：身份是项目内唯一的 Run ID

`wandb.init()` 创建 Run，并返回 `wandb.Run`。
身份是 `id`，显示名是 `name`。
`id` 必须在项目内唯一；删除后不能复用。
`id` 不得包含 `/ \ # ? % :`。S1、S3

官方推荐把 ID 留给生成的 hash，把可读名放进 `name`，把超参放进 `config`。S3、S15

```python
import wandb

with wandb.init(entity="nico", project="awesome-project") as run:
    # Your training logic here
```

官方示例输出把 Run 写成 `exalted-darkness-6`，ID 写成 `pgbn9y21`。S2

### 产品事实：封口靠 context manager、`finish()` 或进程退出

`wandb.init()` 启动后台进程，并把数据同步到 wandb.ai 或自托管实例。S1
`with` 块结束时调用 `run.finish()`。
不调用时，脚本退出也会结束 Run。S1

`v0.28.2` 的 `Run.finish()` 写明最终状态由退出码与同步结果决定：S23

- `Finished`：`exit_code=0` 且数据已同步，或调用了 `finish()`。S4
- `Failed`：非零退出。S4
- `Crashed`：内部进程停止发送 heartbeat。S4
- `Killed`：被强制停止。S4
- `Running`：仍在发送 heartbeat。S4
- `Pending`：已调度未开始，常见于 Sweep 与 Launch。S4

### 产品事实：resume 复用同一 ID，不创建新身份

| `resume` | Run ID 已存在 | Run ID 不存在 |
|---|---|---|
| `"must"` | 从最后一步继续 | 报错 |
| `"allow"` | 从最后一步继续 | 用该 ID 新建 |
| `"never"` | 报错 | 用该 ID 新建 |
| `"auto"` | 尝试自动恢复本机崩溃 Run | 新建 |

S5、S1

`resume_from` 与 `fork_from` 使用 `{run_id}?_step={step}`。
二者都是 beta，且不能与 `resume` 同时使用。S1

`reinit` 控制同一进程再次 `init`：`create_new`、`finish_previous`、`return_previous`。S2
`mode="shared"` 允许多进程写同一 Run，官方标 experimental。S1

### 研究判断

W&B 的稳定身份是「项目内唯一、可 resume 的 Run ID」。
它不是内容寻址，也不是 sealed Attempt。
同一 ID 可以追加 history、改 tags、事后改 config 与 summary。
因此「封口」表示这次计算结束并同步，不表示该身份上的事实此后不可变。

## 2. 官方事实怎样写入

W&B 没有 NiceEval 意义上的官方 Timing / Usage / Score / Evidence adapter。
它把「官方」写成 SDK 内建对象与自动采集，把「用户事实」写成同一套 `config` / `log` / artifact 键。

### 产品事实：config 是输入，history 是过程，summary 是输出

Public API 文档把三者写成：S15

| 属性 | 官方含义 |
|---|---|
| `run.config` | 输入，例如超参或预处理 |
| `run.history()` | `log()` 追加的变化值 |
| `run.summary` | 输出摘要；默认是每个 key 的最后一次 `log` |

```python
import wandb

config = {"epochs": 1337, "lr": 3e-4}
with wandb.init(project="my-awesome-project", config=config) as run:
    run.log({"accuracy": 0.9, "loss": 0.1})
```

一手材料：[SDK README](https://raw.githubusercontent.com/wandb/wandb/v0.28.2/README.md) 与 S3。

`v0.28.2` 的 `Run.log` 签名是 `log(data: dict[str, Any], step=None, commit=None)`。
文档写明它把标量、图像、视频、histogram、plot 与 table 写入 history，并更新 summary。S23

### 产品事实：系统指标与命令行是自动写入

每次 Experiment 自动采集：S7

- 系统指标：CPU、GPU、网络等；GPU 来自 [`nvidia-smi`](https://developer.nvidia.com/nvidia-system-management-interface)
- stdout / stderr，显示在 Run 的 logs 页

打开 Code Saving 后还会保存 git commit、`diff.patch` 与 `requirements.txt`。S7
数据集图像不会自动上传，必须显式 `log`。S7

### 产品事实：metric 名字受 GraphQL 约束

官方要求 metric 名匹配 `/^[_a-zA-Z][_a-zA-Z0-9]*$/`。
不能含逗号、连字符、空格，也不能以数字开头。S7

### 产品事实：summary 可在写入时定制

`define_metric(..., summary=)` 接受 `min`、`max`、`mean`、`best`、`last`、`none`。
`"best"` 必须配合 `objective`。S8

```python
with wandb.init() as run:
    run.define_metric("loss", summary="min")
    run.define_metric("loss", summary="max")
    run.define_metric("acc", summary="min")
    run.define_metric("acc", summary="max")
    run.log({"loss": 0.2, "acc": 0.9})
```

S8。源码还列出 `"first"`、`"copy"`；`"best"` 与 `"copy"` 已在 [BREAKING.md](https://github.com/wandb/wandb/blob/v0.28.2/BREAKING.md) 标记删除。S23

### 产品事实：Table 是带列名的二维事实

```python
with wandb.init() as run:
    my_table = wandb.Table(columns=["a", "b"], data=[["1a", "1b"], ["2a", "2b"]])
    run.log({"table_key": my_table})
```

S10。同一 key 再次 `log` 会生成新版本。
文档写上限 200,000 行；源码区分 `MAX_ROWS = 10000` 与 `MAX_ARTIFACT_ROWS = 200000`。
[Table 源码](https://github.com/wandb/wandb/blob/v0.28.2/wandb/sdk/data_types/table.py)

列类型在使用时固定为 numeric、text、boolean、image、video、audio 等。
作者不必预先声明类型，但必须只往该列写入同类值。S10

预测表的官方形状把 media 与判定放在同一行：

```python
columns = ["id", "image", "prediction", "truth"]
test_table = wandb.Table(data=my_data, columns=columns)
```

S10

### 产品事实：Artifact 是 Run 的输入或输出文件集合

```python
with wandb.init(project="artifacts-example", job_type="add-dataset") as run:
    artifact = wandb.Artifact(name="example_artifact", type="dataset")
    artifact.add_file(local_path="./dataset.h5", name="training_dataset")
    run.log_artifact(artifact)
```

S13

消费侧用 `use_artifact` 声明输入，再 `download()`。S13
`type` 影响 App 中的分类，默认 `unspecified`。S13

同名同 type 再次写入时，W&B 对内容做 checksum。
有变化则保存 `v1`。S14
分布式写入用 `upsert_artifact(..., distributed_id=...)` 与 `finish_artifact`。S14

### 产品事实：media 作为 `log` 字典里的类型化值

`Run.log` 接受 W&B Data Type，包括 `wandb.Image`、`wandb.Table`、plot 与 HTML。S23
`wandb.Image` 的源码签名接受路径或图像数据，以及 `caption`、`boxes`、`masks`。
[Image 源码](https://github.com/wandb/wandb/blob/v0.28.2/wandb/sdk/data_types/image.py)

表格文档中的可核查写法是 `wandb.Image("img_0.jpg")`。S10
matplotlib 可直接 `run.log({"chart": plt})`，默认转成 Plotly。S11

### 研究判断

W&B 的「官方事实」是固定 envelope 上的具名键，外加若干类型化对象。
envelope 是 Run 的 config / history / summary / files / artifacts。
用户扩展的是键名、值与对象类型，不是一份用户版本化 schema。

## 3. 用户能否增加自定义事实；扩展的是什么

### 产品事实：扩展单位是名字和值，外加类型化对象

作者不必注册 schema family。
新事实就是一个新的 config key、`log` key、Table 列名，或一个新的 Artifact `name` + `type`。

config 是字典式对象，可在 `init` 时传入，也可事后 `run.config.update(...)`。
嵌套字典会被点号展平。
键名不要用 `.`。
值应小于 10 MB。S1、S6

```python
config = {"hidden_layer_sizes": [32, 64], "activation": "ReLU"}
with wandb.init(project="config_example", config=config) as run:
    run.config["epochs"] = 4
    run.config.update({"lr": 0.1, "channels": 16}, allow_val_change=True)
```

S6。默认不允许替换已有 config；替换时必须传入 `allow_val_change=True`。

Table 用 `allow_mixed_types` 控制列是否混类型；默认 `optional=True`。
[Table `__init__`](https://github.com/wandb/wandb/blob/v0.28.2/wandb/sdk/data_types/table.py)

Artifact 的版本是内容 checksum 后的 `vN` 与 alias，例如 `:latest`。
这是对象版本，不是用户 payload 的 schema 版本。S14

### 产品事实：本次检查未见用户版本化 schema API

本次检查的一手公开面未提供：

- 用户为某个 metric 或 Table 声明 schema 版本号的 API
- 相邻 migration 函数
- 读取时按 schema identity 投影
- 把 unknown payload 原样复制并验证闭包的契约

Artifact 有版本与 lineage，但版本针对文件集合，不针对「某个领域事实的 schema 代际」。

### 研究判断

对共同问题 3，W&B 的答案是：

| 扩展形态 | 是否公开存在 |
|---|---|
| 名字和值 | 是，config / log / summary / tags |
| 固定 envelope | 是，Run 外壳加类型化 media / table / artifact |
| 任意属性 | 部分是；值必须可被 SDK 序列化，metric 名受 GraphQL 规则限制 |
| 版本化 schema | 否；artifact `vN` 不是用户 schema |

这与 NiceEval 的 RecordAttachment adapter 不同。
NiceEval 要求 sealed domain value、family、current adaptation 与显式 migration。
W&B 让普通作者直接写键。

## 4. 写入 API 是否要求预先决定图表

### 产品事实：默认只写中立键，App 按 key 自动出图

`run.log({"accuracy": acc, "loss": loss})` 不指定图表类型。
Workspace 的 automated mode 会为项目里所有 logged key 生成面板。S17
默认 x 轴是每次 `log()` 递增的 step。S7、S9

同一调用里的多个 metric 可以画在同一张图上。S7
用前缀组织 UI 分组，例如 `train/loss` 与 `val/loss`。
[Support: organize charts](https://docs.wandb.ai/support/models/tags/experiments)

### 产品事实：写入时可以绑定展示，但不是必须

四类写时绑定是公开的：

1. `define_metric(name, step_metric=...)` 指定自动图的 x 轴。S9、S23
2. `define_metric(..., summary=..., hidden=...)` 指定摘要聚合，或把 metric 从自动图里藏起来。S23
3. `wandb.plot.*` / `wandb.plot_table(vega_spec_name=...)` 把图表对象写入 history。S11、S12
4. `run.pin_config_keys(...)` 把 config 键钉到 Overview 的 References。S6

```python
table = wandb.Table(data=data, columns=["step", "height"])
fields = {"x": "step", "value": "height"}
my_custom_chart = wandb.plot_table(
    vega_spec_name="carey/new_chart",
    data_table=table,
    fields=fields,
    string_fields={"title": "Height Histogram"},
)
with wandb.init() as run:
    run.log({"my_custom_chart": my_custom_chart})
```

S11。这里作者在写入时就选定了 Vega preset 与字段映射。

Workspace 与 Report 仍可在读取后另建面板。
Saved view 与 Report 的 panel grid 是读时声明。S16、S19
手动 workspace 从空白开始，只显示作者后加的面板。S17

### 研究判断

W&B 允许「先写中立键，后在 Workspace 构图」。
它也允许「写入时带上 chart 对象或 metric 展示策略」。
展示绑定不是写入的前置条件。
一旦使用 `plot_table` 或 `define_metric`，展示决策就进入持久 Run，而不是只留在 Report。

**NiceEval 建议**：领域写入应保持中立 sealed value。
x 轴、聚合与 Vega preset 属于 Analysis 或 Report，不应成为 producer 义务。

## 5. 读取与分析怎样选择 Run、分母、聚合与缺测

### 产品事实：Public API 用路径取单个 Run，用 MongoDB 查询取集合

```python
import wandb

api = wandb.Api()
run = api.run("<entity>/<project>/<run_id>")
runs = api.runs(
    "username/project",
    {"$or": [{"config.experiment_name": "foo"}, {"config.experiment_name": "bar"}]},
)
```

S15。`api.runs` 默认按 `-created_at` 排序，可按 `summary.val_acc` 或 `config.experiment_name` 排序。
每次加载 50 条，可用 `per_page` 调整。S15

比较两个 Run 的官方示例是把两边的 `config` 做成 DataFrame，再打印不等的键。S15
这是作者自己做差，不是产品级的固定分母 API。

### 产品事实：history 默认采样；缺测以 NaN 出现

`run.history()` 默认采样 500 点。
指定 `keys` 时，不含该 metric 的 step 在 dataframe 里是 `NaN`。S15

`v0.28.2` 源码签名：S24

```python
def history(
    self,
    samples: int = 500,
    keys: list[str] | None = None,
    x_axis: str = "_step",
    pandas: bool = True,
    stream: Literal["default", "system"] = "default",
)
```

`stream="default"` 读 metric history。
`stream="system"` 在 GraphQL 里走 `events` 节点，读机器指标。S24

文档示例曾写 `run.history(stream="events")`。S15
固定源码把公开参数写成 `"system"`，并在内部映射到 `events`。
观察日应以 `v0.28.2` 源码为准。

要完整、未采样的 history，用 `scan_history()`。
`keys` 只返回同时包含这些键的行。
不同 step 写入的键应分开扫描。S15、S24

### 产品事实：事后可以改 summary 与 config

```python
run = api.run("<entity>/<project>/<run_id>")
run.summary["accuracy"] = 0.9
run.summary.update()

run.config["key"] = updated_value
run.update()
```

S15、S6。重命名 summary 列只影响表格。
图表仍使用原来的 metric 名。S15

### 产品事实：Report 侧的选择是 Runset 过滤与分组

代码 API 用字符串或 `FilterExpr` 过滤：S19

```python
runset = wr.Runset(
    entity="[ENTITY]",
    project="[PROJECT]",
    filters="Config('learning_rate') > 0.01 and Config('batch_size') == 32",
)
```

也可按 `SummaryMetric('accuracy') > 0.9`、`Metric('state') in ['finished']`、`Tags('training')` 过滤。S19
分组键可以是 `config.group`、`Name` / `State` / `JobType`，或 `summary.acc`。S19

冻结 Runset 会固定报告看到的 Run 集合，后续新 Run 不再进入。S19

Workspace 可用 pinned run 与 baseline run 做对照。
最多 pin 20 个 Run。
summary 可显示相对 baseline 的 delta。
[Pin and compare runs](https://docs.wandb.ai/models/runs/compare-runs.md)

### 产品事实：Table 比较提供 merge 或 side-by-side

两个作为 artifact version 的 Table 可以按 join key 合并，或并排查看。
[Visualize tables](https://docs.wandb.ai/models/tables/visualize-tables.md)
缺失 step 时，stepper 使用该 slider key 的上一个已写入值。

### 研究判断

W&B 的分析分母是「当前查询选中的 Run 集合」或「报告里冻结的 Runset」。
它不是 NiceEval 的 nominal population。
缺测表现为 NaN、空单元格或沿用上一个值。
Public API 不提供 `unsupported` 或 per-row coverage 枚举。
采样 history 会丢掉点；完整序列必须显式 `scan_history`。

**NiceEval 建议**：不要把采样视图当成事实真源。
Analysis 应在 frozen view 上穷尽 row 状态，而不是默认 500 点。

## 6. 图表、Dashboard 与 Report 怎样消费分析结果

### 产品事实：作者同时使用 UI 与代码，二者不是同一稳定契约

| 作者面 | 做什么 | 稳定性 |
|---|---|---|
| 自动 Workspace | 按 logged key 生成面板 | 产品默认 |
| 手动 Workspace / Saved view | 后加面板并保存布局 | Saved view 可被团队编辑 |
| App Custom Chart | GraphQL 取数 + 编辑 Vega | 文档完整；查询引擎源码未公开 |
| `wandb.plot` / `plot_table` | 写入时带上图表 | SDK 稳定面的一部分 |
| `wandb_workspaces.reports.v2` | 用代码声明 Report / Workspace | Public Preview |
| 旧 `wandb.apis.reports` | 文档仍提到 | 正式入口已指向 workspaces 包 |

S16、S17、S18、S12

创建 Report 的代码入口：S18

```python
import wandb_workspaces.reports.v2 as wr

report = wr.Report(project="report_standard")
report.save()
```

Workspace 与 Report 共用面板类型。S18 仓库 README：

```python
import wandb_workspaces.workspaces as ws
import wandb_workspaces.reports.v2 as wr

workspace = ws.Workspace(
    name="Example W&B Workspace",
    entity="your-entity",
    project="your-project",
    sections=[
        ws.Section(
            name="Validation Metrics",
            panels=[
                wr.LinePlot(x="Step", y=["val_loss"]),
                wr.BarPlot(metrics=["val_accuracy"]),
                wr.ScalarChart(metric="f1_score", groupby_aggfunc="mean"),
            ],
            is_open=True,
        ),
    ],
).save()
```

[wandb-workspaces README](https://raw.githubusercontent.com/wandb/wandb-workspaces/main/README.md)

Report 对象不自动保存，必须 `save()`。
[Report 类源码](https://github.com/wandb/wandb-workspaces/blob/v0.4.5/wandb_workspaces/reports/v2/interface.py)

内建面板包括 LinePlot、BarPlot、ScalarChart、ScatterPlot。
自定义图用 Vega 规范，数据来自 config / summary / history / `summaryTable` / `historyTable`。S12
文档建议每个 key 最多写入约 10,000 点。S12

Query panel 的部分能力标为 beta。
[Query panels](https://docs.wandb.ai/models/app/features/panels/query-panels.md)

报告里的 `WeaveBlock*` / `WeavePanel*` 名字不指 LLM Weave 产品。S19 参考页写明了这一点。

### 研究判断

W&B 的 Report 作者看到的是「选 Runset + 选面板 + 写叙事」。
分析计算大多发生在 App 或作者自己的 notebook 里。
Public API 文档甚至建议分析后再 `wandb.init(job_type="analysis")` 写回一个新 Run。S15

这与 NiceEval 的「Analysis 产出 typed fields，Report 只组合 fields」不同。
W&B 允许报告作者直接写过滤表达式和聚合函数。
它没有把 Analysis 收成独立、可复用的 Dimension / Measure 层。

## 7. 历史数据怎样面对 SDK、schema 与产品升级

### 产品事实：SDK 用弃用警告与次版本破坏性变更

[BREAKING.md](https://github.com/wandb/wandb/blob/v0.28.2/BREAKING.md) 要求破坏性变更必须伴随 minor bump。
条目包括删除 `define_metric` 的 `summary="best"` / `"copy"`，以及 `wandb sync` 的旧选项。

`v0.28.2` 把 `wandb sync --clean` 换成 `wandb clean`。
`wandb sync --sync-tensorboard` 已弃用。
[Release notes](https://github.com/wandb/wandb/releases/tag/v0.28.2)

这些是客户端行为变更。
本次检查的一手公开面未提供「升级 SDK 后重写已同步 Run 字节」的用户 migration API。

### 产品事实：离线先落本地，再 `wandb sync`

```python
os.environ["WANDB_MODE"] = "offline"
```

S20。`mode="offline"` 把数据留在本地 `wandb` 目录，稍后再同步。S1
必须保留 run 目录。S1

```bash
wandb sync ./wandb/run-20170617_000000-abcd1234
wandb sync --sync-all
```

S21。无参数的 `wandb sync` 只打印已同步 / 未同步摘要。
CLI 正在迁到 `wandb beta sync`；部分选项只在 legacy 或 beta 一侧有效。S21

UI 显示 `crashed` 但本机仍在跑时，官方建议 `wandb sync PATH` 找回数据。
[Support: crashed but still running](https://docs.wandb.ai/support/models/tags/experiments)

### 产品事实：服务端升级是换镜像与 license，不是用户 schema migration

自托管升级走 Terraform 或 Helm，改 `wandb_version` / `image.tag` 与 `license`。S22
[Helm upgrade 指南](https://github.com/wandb/helm-charts/blob/main/upgrade) 是公开仓库。
Admin UI 只能换 license，不能换 Server 版本。S22

`wandb/server` [0.83.0](https://github.com/wandb/server/releases/tag/0.83.0) 有一条修复：通过 API 给已结束 Run 上传的文件可能不出现在 Run 页。
该修复要求 SDK ≥ `v0.28.1`。
它不是整份 Server 升级的通用 schema migration 声明。

本次检查的一手公开面未提供：

- 用户 payload 的 schema migration 图
- 升级后重写持久 history 的官方步骤
- 旧 metric 名到新 schema 的自动投影

用户能做的是事后改 config / summary，或把分析写进新 Run。S15
重命名 summary 不会改图表引用的原名。S15

### 研究判断

W&B 把兼容性放在 SDK 弃用周期和服务端版本配对上。
它不把「旧数据升到新领域 schema」做成用户可见的 plan / authorize / receipt。
历史 Run 靠 ID 继续可读；解释变化靠作者改键、改面板或新开 analysis Run。

**NiceEval 建议**：不要学「事后改 summary」。
要学的是：客户端破坏性变更必须公开、可预期；服务端升级与用户事实 migration 必须分开。

## 8. 四类作者分别需要理解多少层

| 作者 | 主路径 | 必须理解 | 不应被迫理解 |
|---|---|---|---|
| 普通应用作者 | `wandb.init`、`config`、`log`、`finish` | project / entity、Run ID、key 命名 | GraphQL、Vega、artifact checksum、server license |
| 扩展作者 | `wandb.Table`、`wandb.Image`、`wandb.Artifact`、`plot_table`、integration | 类型化对象、artifact type / alias、写时图表 preset | Record host、migration trust |
| 分析作者 | `wandb.Api()`、Mongo 查询、`history` / `scan_history`、pandas | 采样与 NaN、config 对 history、可突变的 summary | Report 块模型、Helm |
| 报告作者 | App UI 或 `wandb_workspaces` | Runset 过滤 / 分组 / 冻结、面板类型 | SDK 内部进程、filestream、服务端存储 |

普通应用作者通常只看到一层：Run 上的字典式写入。
扩展作者看到第二层：类型化 media / table / artifact，以及可选的写时图表。
分析作者看到第三层：Public API 与采样 / 完整 history。
报告作者看到第四层：Workspace / Report 的面板声明。

这四层共享同一 Run 事实，但不是同一 import surface。
Public Preview 的 workspaces 包把第三层与第四层部分重叠：报告作者也可以写过滤表达式。

### 研究判断

W&B 用「同一 Run 对象、多套读取 API」降低普通作者成本。
代价是分析与报告没有从写入面收走聚合和过滤。
NiceEval 若吸收「普通作者只写领域 API」，不应同时吸收「报告作者直接查询原始 history」。

## 四个 NiceEval 场景

### 场景 A：官方 OTel Timing

**产品事实**：Models 的自动 Timing 是系统指标与 `_timestamp` / `_runtime` / `_step`。
GPU 利用率来自 `nvidia-smi`，不是 OTel span。S7
OpenTelemetry 导入出现在 Weave 的 [`/otel/v1/traces`](https://docs.wandb.ai/weave/guides/tracking/otel.md)，不属于 Models Run。

本次检查的一手公开面未提供：把官方 OTel Timing 写成 Models Run Attachment 的 API。

**研究判断**：W&B Models 不能映射 NiceEval 的官方 OTel Timing family。
最接近的是自动系统指标流，以及用户自己 `log` 的 duration 键。

**NiceEval 建议**：官方 Timing 必须走领域 adapter，而不是让用户 `log({"duration": ...})`。
自动采集可以存在，但不能代替 sealed Timing 值与穷尽状态。

### 场景 B：用户 GPU Energy

**产品事实**：用户可以直接写：

```python
with wandb.init(project="gpu-energy") as run:
    run.log({"gpu_energy_j": 1234.5})
```

这只是一个新 metric 名。S7、S23
系统侧可用 `run.history(stream="system")` 读机器指标。S24
本次检查的一手公开面未提供 joule、NVML energy 或 GPU Energy plugin 契约。

**研究判断**：扩展单位仍是名字和值。
没有 GPU Energy schema、没有 installation、也没有 Analysis field。
报告作者若要画这张图，必须知道键名 `gpu_energy_j`。

**NiceEval 建议**：第三方 GPU SDK 应导出领域 Plugin 与 `analyzeGpuEnergy()`。
普通 Eval 作者不应看见 Record key。

### 场景 C：Assertion 与 Evidence

**产品事实**：最接近的公开形状是带 `prediction` / `truth` / `image` 的 Table，以及作为 artifact 保存的文件。S10、S13
Table 可含 `wandb.Image` 与 confidence 列。S10
作者可用 `run.log({"table_key": table})` 多次写入，比较模型随时间的预测。S10

本次检查的一手公开面未提供 Assertion、Verdict、Evidence basis 或 evaluator 身份。
Table 行可以被后补；Public API 也可以改 summary。S15
这不是不可变 Claim。

**研究判断**：W&B Table 适合「把证据和判定放在同一行给人看」。
它不适合「evaluator 依据哪些材料作出不可变判定」。

**NiceEval 建议**：可以吸收「一行里同时放 subject、判定与 media」的作者体验。
不可变 Evidence 与 evaluator 版本必须留在 RecordAttachment，而不是普通 table 行。

### 场景 D：旧数据升级后重新分析和报告

**产品事实**：已结束 Run 仍可用 Public API 改 config 与 summary。S15、S6
也可以 `upload_file` 给已结束 Run。S15
不能靠官方 migration 图把旧 history 键批量改写成新 schema。
图表在重命名 summary 后仍引用旧名。S15

服务端升级换的是应用版本与 license，不声明重写用户 Run。S22
离线目录用 `wandb sync` 补传，不改已同步字节的 schema。S21

重新分析的官方路径是：用 Public API 拉 dataframe，再 `wandb.init(job_type="analysis")` 写新 Run。S15
报告侧可冻结 Runset，避免新 Run 改写旧叙事。S19

**研究判断**：W&B 把「旧数据」当成仍可变的 Run 文档，外加一份只读报告快照。
NiceEval 把旧数据当成 frozen view，升级必须显式 plan 与 authorize。

**NiceEval 建议**：吸收「报告可以冻结分母」。
不要吸收「分析作者直接改历史 summary」。
旧 schema 应保留原字节，由 adapter migration 生成新 Attachment。

## 写入时何时绑定展示

| 时机 | 公开机制 | 绑定了什么 |
|---|---|---|
| 写入默认 | `log({key: value})` | 不绑定图表类型；只绑定 key 名 |
| 写入可选 | `define_metric` | 自动图 x 轴、summary 聚合、是否隐藏 |
| 写入可选 | `plot` / `plot_table` | Vega preset 与字段映射 |
| 写入可选 | `pin_config_keys` | Overview 上的 References |
| 读取后 | Workspace 面板、Saved view | 布局、过滤、比较 |
| 读取后 | Report / Runset | 分母、分组、冻结、叙事 |

普通应用作者可以全程不选图表。
扩展作者一旦调用 `plot_table`，就把展示写进 Run。
报告作者可以完全不管写入时的图表，另做一份声明。

## 产品事实、研究判断、NiceEval 建议

### 产品事实

1. 用户进程调用 SDK，同一产品用 App 与 Public API 读取同一 Run。
2. 稳定身份是项目内 Run ID；resume 复用该 ID。
3. 用户扩展主要是名字、值和类型化对象，不是版本化 schema。
4. 写入默认中立；写时绑定图表是可选的。
5. 读取默认采样；完整 history 要另调 API。
6. 已结束 Run 的 config / summary 仍可改。
7. SDK 开源且可固定版本；服务端应用源码与用户 schema migration 未公开。
8. Report / Workspace 代码 API 是 Public Preview。

### 研究判断

W&B 证明「运行写入 + 同一产品分析展示」可以做成一条大众路径。
它靠降低普通作者的层数取胜：一个 Run 对象写完就能看图。
它没有把 Analysis 收成独立、带 coverage 的字段层。
它也没有把历史事实做成不可变 revision。

对 NiceEval 最有对照价值的，不是面板样式，而是分层是否分清。
W&B 把扩展做成「再加一个 key」。
NiceEval 把扩展做成「领域 SDK + adapter + 显式 installation」。

### NiceEval 建议

1. 普通 Eval 作者应只看到领域 API，对应 W&B 普通作者只调用 `init` / `log`。
2. 不要把 metric 名当成 schema identity。
3. 不要让写入 API 默认携带 Vega 或图表类型。
4. Analysis 必须声明分母、缺测与 unsupported，不能只返回 NaN。
5. Report 应消费 Analysis fields，而不是直接 Mongo 查询 history。
6. 升级必须有用户可见的 plan / authorize / receipt，而不是事后改 summary。

## 值得吸收 / 不应复制 / 尚缺证据

### 值得吸收

- 同一产品包含写入、查询与展示，而不是把分析交给外部 BI。
- 普通作者默认只写中立键；自动图是读侧面的增强。
- Run 身份、显示名、notes、tags、config 分开，避免把超参写进 ID。
- Artifact 用 checksum 升版，并用 `use_artifact` / `log_artifact` 表达输入输出。
- 离线目录与 `wandb sync` 把「先本地后上传」写成显式步骤。
- SDK 破坏性变更有公开弃用清单与 minor bump 规则。
- 报告可以冻结 Runset，让叙事不随新 Run 漂移。
- 四类作者可以用不同 API，而不必共享一个万能 client。

### 不应复制

- 把用户扩展做成无版本的全局键空间。
- 允许分析作者改写已结束 Run 的 summary / config。
- 默认采样 history，却把采样结果呈现为完整事实。
- 把写时 Vega preset 与中立事实写在同一条 `log` 语义里而不分层。
- 用滚动文档加 Public Preview 代码 API 充当稳定 Report 契约。
- 把服务端闭源应用伪装成「仓库 MIT 即平台开源」。
- 用事后改键代替 schema migration。
- 把系统指标或 Weave OTel 误写成 Models 的官方 Timing 契约。

### 尚缺证据

- 服务端如何存储 history、table 与 artifact 的物理格式。
- GraphQL 查询语言是否有稳定、版本化的公共 schema。
- Workspace / Report 代码 API 何时退出 Public Preview。
- `resume_from` / `fork_from` / `mode="shared"` 的最终契约。
- 升级 Server 或 SDK 后，旧 Run 的哪些字段保证字节级不变。
- 缺测、partial、unsupported 是否存在比 NaN / 沿用上值更明确的公开枚举。
- Models Run 与 Weave Call 是否存在官方联合查询，而不仅是同一账号下的两个产品。

这些缺口只能等官方文档、正式 migration 说明或开源服务端后再补。
在此之前，不应把内部实现写进 NiceEval 契约。
