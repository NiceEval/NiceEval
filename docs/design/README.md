# 设计决策文档

这里存放需要对比多个候选方案、并给出选型裁决的架构 / 技术决策——不是产品功能契约，功能契约见 [Feature](../feature/README.md)。

典型场景：换一个底层组件、在多种架构之间选型、要不要引入一个新依赖。
判断标准是"有没有值得摊开比较的候选项"；只有一种做法、没有分歧的技术细节直接写进 `architecture.md` 或对应功能页，不建这里的子目录。

## 结构

一个决策主题一个子目录，按下面顺序展开：

- `GOALS.md`：这个决策要达到什么、不达到什么，只写目标不写方案。
- `LIMITS.md`：候选共同面对的现状约束和外部事实，不下裁决。
- `CASES.md`：真实场景影响选型时，定义方案中立的输入、验收结果与稳定 Case ID。
- `PLAN-N/`：每个候选方案一份自包含 Feature Design Package，编号从 1 递增。
  `README.md` 必备，Library、CLI、Architecture、Lifecycle 与 Use Case 按候选形态选用。
- `DECISION.md`：综合 `GOALS.md` 与 `LIMITS.md` 后的最终裁决，包括为什么否决其它候选项。

## 当前闭环

从 `pnpm run repo docs design --help` 进入当前命令。`create` 创建外层与候选 Plan，`check` 只检查指定 Design 的结构和关系，`decide` 把一个直接 Plan 写为 `selectedPlan` 并写入裁决。参数与准确 selector 只以 `--help` 为准；不手工复制 [Design Decision](../_template/design-decision/README.md) 或 [Feature Design Package](../_template/feature-design/README.md) 模板。

刚创建的 Design 可以没有 `selectedPlan`：这表示候选尚未裁决，而不是缺损。`decide` 成功后该字段必须指向一个直接 `PLAN-N/README.md`，此时才表示已经裁决。被选 Plan 的标题、`DECISION.md` 中的普通链接和正文描述帮助人阅读，不能取代这个 typed ref。

完成裁决后，把决定采用到相应的 Feature、Roadmap 或 Engineering owner；Design 保留比较过程与理由，不成为当前产品或工程契约的第二真源。

每个 PLAN 必须独立给出完整调用面、架构、生命周期与错误语义。
候选之间可以比较差异,不能用"未说明部分继承 PLAN-X"提供必需契约。
根 `CASES.md` 只定义共同问题;`PLAN-N/use-case/` 只展示本候选怎样兑现对应 Case ID。

已裁决 Design 的 README 用唯一 `selectedPlan` typed ref 指向本目录直接包含的 PLAN。未裁决 Design 合法地没有这个字段。

## 和 Feature / Roadmap 的边界

`feature/` 与 `roadmap/` 写产品最终要满足的目标状态，不描述`实现进度`。
这里的文档写的是选型过程本身——候选项的现状、取舍和裁决都是一次性的决策存档，定稿后不需要重写成目标状态；决策改变时新增 `PLAN-N/` 或更新 `DECISION.md`，不回改旧版本的裁决。

选型落地后，产品要满足的契约仍然要写回 `feature/` 或对应设计页；这里只保留"为什么选它"。

## 当前决策主题

- [Agent 安装配方](agent-install-recipe/README.md)
- [Benchmark Web 消费](benchmark-web-consumption/README.md)
- [CLI Insight](cli-insight/README.md)
- [文档追溯](docs-traceability/README.md)
- [Sandbox 声明模型](environment-model/README.md)
- [Eval Suite 共享](eval-suite-sharing/README.md)
- [实验加速](experiment-speed/README.md)
- [多容器 Sandbox](multi-container-environments/README.md)
- [Nested Docker 执行](nested-docker-execution/README.md)
- [Observability Package Layout](observability-package-layout/README.md)
- [Prepare 命令](prepare-commands/README.md)
- [Projection API](projection-api/README.md)
- [Record Runtime](record-runtime/README.md)
- [Record Storage](record-storage/README.md)
- [Relations API](relations-api/README.md)
- [Report Authoring](report-authoring/README.md)
- [可读测试](user-readable-testing/README.md)
- [Record 到 Report 历史地图](record-to-report-stack.md)
