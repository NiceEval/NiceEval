# 主题上提为独立可分发制品；seriesPins 留在报告

**日期**：2026-07-25

## 裁决

主题从「报告外壳的一个内联令牌对象」上提为**与报告并列的第二份装载物**：`defineTheme` 产物有自己的四档取值链（`--theme` → 报告外壳 `theme` → `config.theme` → 内建 `basalt`），自带 `styles` 完整 CSS 出口，令牌面扩到含中性面、字体、字号与圆角，按 npm 包或本地文件分发。官方主题定名 **Basalt**（黑色系、零圆角、发丝分隔线），同时是官方样式每个 `var(--nre-*, <default>)` 使用点的兜底值——「不声明任何令牌」与「装 Basalt」必须是同一个样子。

同批的一条搬家裁决：**`seriesPins` 从 `ReportTheme` 移到 `ReportShell`**。

## 曾选方案与否决理由

- **主题继续只做 6 色 + 内联在外壳**：否决。一份不能改字体、表面与圆角的东西不是主题，是调色板；而且welded 在报告文件上就没法「一份品牌套多个报告」。
- **主题给 `extends`（像报告那样）**：否决。令牌是扁平对象，`{...base, accent}` 已经表达清楚；`styles` 做成 `ReportAsset[]` 后拼接也是普通数组操作。再加一层合并语义只会让「这个色从哪来」多一个要查的地方。
- **档与档之间深合并**：否决。定为「档只选一份，未声明的令牌取 Basalt 值」，与外壳 `extends` 的整字段覆盖同一条纪律——读一份主题文件就知道站点最终长什么样。
- **`seriesPins` 留在主题里**：否决。pins 说的是数据含义（「baseline 恒中性」），主题一旦可换，把它放在主题里就意味着换配色会让基线和候选方案对调身份。分工定为：**主题只给颜色，报告只给含义，页级色分配只产出下标**——所以换主题不触发任何重算。
- **内建主题名叫 `default`**：否决。与内建报告视图名 `standard` 对齐，用具体名字而不是魔法词；`--theme basalt` 和 `--theme <自己的>` 是同一类取值。
- **读者可覆盖作者的 accent（Obsidian 的用户级设置）**：否决。发布出去的 benchmark 站，颜色是作者的表述。只保留浅/深切换：`appearance: "system"` 时页头给控件，`light`/`dark` 锁死不给。
- **社区主题注册表 / 安装 UI**：否决。npm + `import` 已经是分发机制，宿主不长注册面。

## 实现前必读：令牌面对不上

docs 说的公开令牌（`--nre-accent` / `--nre-series-1..6` / `--nre-page` / `--nre-text-muted` …）在代码里**一个都不存在**。`src/report/assets/styles.css`（约 2000 行）用的是 `--nre-c0..c5`，中性面直接消费了 view 的无前缀变量（`--muted` / `--line` / `--panel` / `--panel-2` / `--blue`）。主题的任何实现都必须先做这次令牌面归一，且要逐处判语义（同一个 `--muted` 在不同规则里可能分别对应 `text-muted` 与 `text-soft`），不能机械替换。改完记得 `pnpm run build:report`，否则 link 消费项目看不到变化（见 [[linked-consumer-stale-dist-report]]）。

落点：契约在 `docs/feature/reports/library/theme.md` 与 `docs/feature/reports/themes/basalt.md`，实现 TODO 在 `plan/report-theme.md`。相关：[[report-page-level-color-assignment]]、[[config-report-value-not-path]]。
