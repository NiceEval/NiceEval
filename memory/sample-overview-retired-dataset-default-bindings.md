# 设计裁决:SampleOverview 退役,Dataset 缺省绑定接住动态标签

- **裁决**(2026-07-29):报告层新增「Dataset 缺省绑定」机制——`Dataset.defaults`(x / y /
  完整 series 声明,全部字段名)由 Source 的 `compute()` 产出,`Chart` 对应 props 省略时取用,
  显式 props 逐槽位覆盖。承载判断的新数据源 `sources.measure.frontier` 读
  `snapshot.scoringComposition` 与 `labelKeys` 选主读数与 series 维度;`SampleOverview`
  整体退役,内建首页改为三行静态标签(`SampleSummary` + frontier `Chart` +
  `sources.entity.experiments` `Table`)。
- **曾选方案 1**:新 source 用固定字段名(y 恒叫 `primary`、series 维度恒叫 `series`)。
  否决:`by` 的维度名是页级配色身份的键,改名后同一 agent 在散点、表格、图例里不再同色。
- **曾选方案 2**:默认页写死 `y="passRate"`。否决:纯计分制 Sample 散点画错轴。
- **行为收窄**:mixed Sample 的默认散点只画通过制那组(退役前 SampleOverview 按题型拆两组、
  双图双表);计分制组要散点的话在自定义报告里写第二张显式 `Chart`。理由:`passRate`
  是唯一默认 KPI,双 y 轴散点不可读;摘要与实验表的 mixed 双主读数不变。
- **准入影响**:measure 家族准入判据增补第二条理由「承载单点规则」
  (`docs/feature/reports/components/sources/measure.md`);Composition 准入判据落在
  `docs/feature/reports/components/README.md`——摊开后只剩静态标签的组合不配名字。
  `StabilityOverview` 不适用退役:它是约 90 行对 `StabilityContent` 的真实投影加工,
  不复制任何口径。
