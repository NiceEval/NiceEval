# 内建任务视图 failures/stability 与 measure 家族封口

日期：2026-07-28，紧接同日的组件文档重组与口径目录裁决。

## 裁决一：内建视图 1 → 3，准入判据成文

- **裁决**：新增 `failures`（失败处理台：FailureList + SampleFixPrompt）与 `stability`
  （稳定性：StabilityOverview），各一张导航页加复用的 `standardAttemptPage`；裸跑兜底仍是
  `standard`。准入判据写进 built-in.md：零配置可算 + 任务高频 + 塞进 standard 会稀释首页。
- **曾选方案**：最初评估结论是「一个 standard 就够，其余靠 show flag 承载」；用户裁决要做。
  判据因此从「要不要」转为「哪些配」——成绩单（分母要用户声明）与对照（条件顺序来自
  `--exp`）被第一条挡下，flaky/稳定性与失败处理正好过线，且各补一块真空缺
  （FailureList 此前不进任何官方零配置面；--stats 此前没有 web 面）。

## 裁决二：measure 家族封口，trend 否决

- **现象**：家族沿「按任务铸名字」的轴在长（rows/matrix 通用，scoreboard/delta/stability
  任务名），我一度顺着惯性提出 `sources.measure.trend`。
- **裁决**（用户点破「为什么不断加 measure，是不是该由需要的组件从数据算」）：
  封口判据落 measure.md——新问题三步问（换 Sample 范围 / rows·matrix 换维度 /
  Composition 普通 JS 加工），三个都不能且新口径有独立正确性判据才开名字。趋势停在第一步：
  历史范围的 Sample 选择器 × `rows({ dimensions: ["run"] })`，不是新 Source。
- **边界重申**：「组件自己算」只对了 Composition 那一半（data 形态字面投影），renderer
  零领域取数的三条硬理由（refs 证据链 / 口径分叉 / 耦合搬家）不动。StabilityOverview
  的散点与堆叠柱因此全是字面投影，零新数据源；唯一动的 Source 契约是 StabilityCell 补
  `refs`（证据链补强，show --stats 同受益）。

遗留方向：stability 数据源内部自读 `historyAttempts` 与「范围归 Sample 轴」同一批判据相悖，
未来历史范围选择器落地时应回头收敛。
