# 报告收窄靠前置选择器，不在界面上二次筛选

[Reading](../../feature/reading/README.md) 已把读面拆成 Record → Sample → Reports。
收窄（哪些 experiment / eval / 是否只要新执行）在契约上属于 **Sample 与宿主命令行**，不是呈现组件的本地状态。
本主题记录现行 web 面「只看新执行」表头开关带来的误读，并候选：**报告按前置 Sample 重算整页，禁止在报告 UI 内再切口径**。

Feature 现行仍含 [实验表 · 只看新执行](../../feature/reports/components/summaries/experiment-table.md#只看新执行) 的 web 开关；本页是尚未定稿的产品/架构候选。

## 解决的问题

### 现象（已复盘）

MemoryBench 一类工作流：批量 `accept` + `exp` 携带后，现刻水位几乎全是 **historical**（`carried`）。

按现行契约：

1. `hasHistoricalOrStale` 为 true → 表头画出 **「只看新执行」** 开关（docs：有历史执行或过期结论才画）。
2. 开关打开 → 行集改走 `sample.freshOnly()`，只留「最新 Run 且非携带」的实测 attempt。
3. 全 carry 时表几乎清空；用户以为 accept 把结果弄没了。

根因不是「开关没按 docs 移除」：docs 只说 **无历史且无过期时不画**；全 carry 时**该画**。  
问题是：**把「换一套 Sample 口径」做成表内 checkbox**，读者把榜单过滤当成数据丢失。

### 与分层契约的张力

[Reading · 宿主与收窄](../../feature/reading/README.md)：

> 收窄是选择层的事，写在命令行上。……命令行表达不了的挑选走 `publish()`，而不是给 CLI 加谓词语法。

现行 `--fresh` / `currentSample({ fresh: true })` 符合「前置选择」。  
web 表头开关却在 **Reports 呈现层** 再投影一份 `freshOnly` 行集（`standardOverviewResult.freshExperiments` + CSS `:has` 显隐），等于：

```text
装载 → Sample(current) → 报告任务函数再派生 Sample(fresh)
                         → 同一页面两套行集，读者用 UI 切换
```

这与「判断写进 Sample 返回值、消费 `attempts` 即正确」一致于**数据**，却在 **交互** 上把第二套口径藏进组件。无 JS 时默认完整表；有 JS 时一键切到空表——可访问性与可讲清楚性都差。

### 为何「在界面上选」特别糟

| 点 | 说明 |
|---|---|
| 默认真相被第二态盖住 | 榜单默认应是现刻水位；fresh 是作者/调试口径，不是读者默认 |
| 全 carry 时开关几乎无有效「开」态 | 打开 = 空或残表，控件「能改行集」但改完不可用 |
| 与 dry/stats 叙事冲突 | 规划与历史面仍满，只有 web 表在 fresh 下空 |
| 组件双份 Content | 表体两套 DOM，维护与测试要锁「投影 ≡ freshOnly()」 |

## 核心心智

```text
前置选择器（宿主 / Sample API / 出站参数）
    → 唯一一份 Sample
    → 报告只渲染这一份
```

- **换口径 = 换 Sample 再生成报告**（CLI 重跑 show/view、站点重建、或未来的「选择器页 → 深链」），不是表头勾选。
- **时效仍可呈现**：历史执行用时距、降饱和、tooltip（[时效不写字](../../feature/reports/components/summaries/experiment-table.md#时效不写字)）；那是**解释出身**，不是**再滤一层贡献集**。
- **CLI `--fresh` 可保留**为作者工具：`niceeval show --fresh` / `view --fresh` 在**装载边界**注入 `fresh: true`，整页只有一套行集。

## 候选契约

### 报告不提供「口径开关」

1. **删除（或永不增加）** 报告组件内会改变 Sample 贡献集合的控件：  
   包括但不限于实验表「只看新执行」、以及未来任何「只看 failed / 只看某 agent」的表内 filter——除非它只是 **视觉折叠** 且不改变计票分母与导出 JSON。
2. 内建首页任务函数 **只消费一份** `Sample`；不再计算并下发 `freshExperiments` 双态 Content。
3. 需要 fresh 水位时：宿主前置 `fresh: true`（CLI flag 或 view 构建参数），**整站/整次 show 重算**。

### 前置选择器放哪里

| 入口 | 候选形状 |
|---|---|
| CLI | 保持 `--exp` / eval 前缀 / `--fresh` / `--record`（与 [Reading](../../feature/reading/README.md) 一致） |
| 静态站点 | 构建时参数钉死一份 Sample；要另一口径 = 另一构建或另一路径产物，不是运行时 checkbox |
| 未来交互站（若做） | **选择器在报告壳之外**（URL query / 独立「范围」页）→ 触发重新 `openRecord`+`currentSample`+render；报告树无内部口径 state |

### 与「不画开关」现行规则的关系

现行 Feature：「无历史且无过期 → 不画开关」。  
本候选更强：**即使有历史，报告 UI 也不提供切换**；历史用行级时效表达。  
「不画」从「控件无意义时隐藏」升级为「呈现层根本不承担口径选择」。

### 明确保留

- Sample 的 `fresh` 字段与 `freshOnly()`（选择层 API）。
- CLI / 宿主装载时的 `--fresh`。
- 行级 historical 标记与相对时距（呈现层只读，不二次筛选贡献）。

### 明确不包含

- 是否删除 CLI `--fresh`（默认保留）。
- [现刻水位物理优先](../sample-contribution-physical/README.md)（贡献规则翻案，与本主题正交，可并行定稿）。
- 报告主题、布局、多页导航（页切换不是 Sample 口径）。

## 触发记录（台账）

| 项 | 内容 |
|---|---|
| 表面 | web 实验表 `.niceeval-fresh-toggle`「只看新执行」 |
| 场景 | accept + carry 后水位几乎全 historical；打开开关表空 |
| 误读 | 结果被删 / accept 失败 |
| 真实 | 前置应是 current 水位；fresh 是另一套 Sample |
| 关联 | MemoryBench 线上报告；与 selectedEvalIds 声明写窄导致的 1/36 是另一条线 |

## 待裁决

1. **web 开关处置**  
   - A：Feature 删除 web 开关与 `freshExperiments` 双态（推荐）。  
   - B：仅当存在「至少一条新执行」且混有历史时才画（减轻全 carry 空表，仍保留表内切口径）。  
   本候选倾向 A；B 仍违反「口径不在报告内选」。

2. **静态站如何提供 fresh 视图**  
   - 不做（只用 CLI）。  
   - 构建两份 out（默认 current + 可选 `site-fresh/`）。  
   - 未来壳层选择器 + 重建（超出当前静态 view 范围）。

3. **JSON / 导出**  
   `show --json` 是否继续暴露与 `--fresh` 绑定的单一 `fresh` 字段即可；禁止导出「同页两态」结构。

## 否决

- **用 CSS/文案弱化开关但保留双态 DOM**——问题在模型（页内两套 Sample），不在样式。
- **默认打开「只看新执行」**——对 carry 主导的评测站更糟。
- **在报告组件内再加「只看 failed」等口径 filter**——同一错误类。

## 定稿后需改写的 Feature 锚点

- [`experiment-table.md` · 只看新执行](../../feature/reports/components/summaries/experiment-table.md#只看新执行)
- [`reports` 内建首页任务 / `StandardOverviewResult`](../../feature/reports/library/built-in.md)（`freshExperiments`）
- [Reading · 收窄](../../feature/reading/README.md)（补一句：报告 UI 不二次收窄贡献集）
- [engineering/testing/unit/reports.md](../../engineering/testing/unit/reports.md)「只看新执行的重投影」——删或改为「仅宿主前置 fresh」

## 相关阅读

- [实验表 · 只看新执行](../../feature/reports/components/summaries/experiment-table.md#只看新执行) —— 现行开关契约
- [Sample · fresh](../../feature/sample/library.md#时效新执行与历史执行) —— 选择层口径
- [Reading](../../feature/reading/README.md) —— 收窄归宿主与 Sample
- [现刻水位贡献：物理优先](../sample-contribution-physical/README.md) —— 贡献集怎么取（正交）
