# Harbor 的读取、查询与比较

本页回答用户怎样重新打开本地 Job 或 Hub Job，怎样下钻 Trial、分析失败、对齐 Task，并比较 Agent、model 与 Dataset。
磁盘和 Hub 的事实形状见 [存储与权威事实](storage.md)。

## 用户从哪里进入结果

Job 完成后，用户通过 CLI、本地 viewer 或 Hub 重新进入结果：

```bash
harbor view jobs
harbor analyze <job-dir>
harbor upload jobs/<job>
harbor hub job show <job-id>
harbor hub job compare <job-id> <job-id-2>
```

## 本地 viewer

```bash
harbor view jobs
```

viewer 默认绑定 `127.0.0.1:8080-8089`。
官方列出的能力包括：

- 按 Agent、model、Dataset 与日期筛选 Job。
- 查看 Trial reward、时长与错误。
- 逐步查看轨迹。
- 查看 token 和分阶段耗时。
- 查看 artifact。
- 选择多个 Job 做矩阵比较。
- 对失败做 AI 摘要。

见 [Run Evals：Using the Viewer](https://harborframework.com/docs/run-jobs/run-evals#using-the-viewer)。

`JobScanner` 把每个子目录当作 Job 名，并读取 `config.json` 与 `result.json`。
Trial 子目录则只要求存在这两个文件之一。
扫描逻辑见 [`viewer/scanner.py`](https://github.com/harbor-framework/harbor/blob/ac398bbda7c4c1073461797d3b95c2455cc671b5/src/harbor/viewer/scanner.py)。

viewer 还提供本机再次发起 `harbor run` 的 UI，以及把 Job 上传到 Hub 的操作面。
这些操作位于同一本地服务器，不是第二套存储模型。

## 本地比较网格

比较网格由 `GET /api/compare?job=` 在读取时拼出，不另存结果表：

| 维度 | 值 |
|---|---|
| 行 | `(source, task_name)` |
| 列 | `(job_name, agent, provider, model)` |
| 格 | 平均 reward、平均时长与 Trial 数 |

缺格表示该组合没有 Trial。
格中的 reward 为空时按 0 参与列平均、行平均与排序。

比较结果依赖当前所选 Job 和 Task 名。
具体对齐、分组与缺测语义见下文。

## 终端结果与后补分析

`Job.run` 结束后，CLI 打印结果表。
`harbor jobs summarize` 已删除，官方文档把用户引向 `harbor analyze`。

`harbor analyze <job-or-trial-dir>` 自己再启动一个 Harbor Job，并把摘要写回被分析对象：

- 每个被分析 Trial 的 `analysis.json`，类型为 `AnalyzeResult`。
- Job 根上的 `analysis.json`，类型为 `JobAnalyzeResult`。

viewer 读取这些文件展示摘要。
`analysis.json` 是后补注释，不是 verifier reward。
结果目录入口见 [Run Evals：Analyzing Results](https://harborframework.com/docs/run-jobs/run-evals#analyzing-results)。

## Trial handoff

`harbor trial handoff` 把已完成 Trial 的 native session 交回本机 Agent CLI。
观察日只支持 `claude-code`。

handoff 恢复对话，不恢复容器内文件。
见 [Trial Handoff](https://harborframework.com/docs/run-jobs/handoff)。

## Harbor Hub

Hub CLI 提供以下读取与管理入口：

```bash
harbor hub job list --scope my|shared|all
harbor hub job show <job-id>
harbor hub job tasks <job-id>
harbor hub job trials <job-id> --failed-only --include-retries
harbor hub job compare <job-id> <job-id-2>
harbor hub job shares <job-id>
harbor hub job delete <job-id>
```

Job 的筛选维度是 search、agent、provider 与 model。
Trials 还可以按 `started_at`、`task_name`、`name` 或 `error_type` 排序。

只有指定 `--include-retries` 才会带上重试历史。
默认结果只显示每个逻辑 Trial 的最新执行。

Hub 网站提供同一套 overview：Trial 数、错误、retries、Metric 均值、USD 费用与 token。
服务端怎样预先聚合并保存这些数字，本次检查的一手公开面未提供。

分享入口见 [Share Jobs](https://harborframework.com/docs/sharing/jobs)，Hub 查询面见
[Hub](https://harborframework.com/docs/hub) 与托管站 [Harbor Hub](https://hub.harborframework.com)。

## `leaderboard`

`leaderboard` 是 Hub 上的策展对象，不是 Job 的自动投影。
每一行手动关联 `trial_ids`。

修改 association 不会重算行上的 metadata 或 metrics。
Dataset 版本在创建 leaderboard 时固定；之后新发布的版本不会自动加入。

definition 与 row 可以一次提交。
schema 变更只要有一行无效就整批拒绝，`--dry-run` 只校验而不提交。

## 对齐、分组与多次尝试

Harbor 没有独立 align API。
比较网格使用 Task 名对齐，Regrade 也使用 Task 名把源 Trial 配到新的 verifier Task。

JobStats 的分组键是 `agent__model__dataset`。
没有 model 时是 `agent__dataset`。

`n_attempts` 表示同一 Task 的多次 Trial。
这些 Trial 一起进入 `pass_at_k` 和平均 reward。

缺测语义很弱：

- Metric 把缺失 reward 当作 0。
- 比较网格把空 reward 当作 0 参与排序。
- Harbor 没有具名的 missing、partial、unsupported 状态机。

Metric 的公开规则见 [Metrics](https://harborframework.com/docs/datasets/metrics)。
