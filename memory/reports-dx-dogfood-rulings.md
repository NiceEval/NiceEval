# 设计裁决:Reports DX 试写回灌(2026-07-16)

第四轮评审（[reports-fourth-review-rulings](reports-fourth-review-rulings.md)）后，在真实 eval repo（`/Users/ctrdh/Code/coding-agent-memory-evals`）按新契约试写了一份多页报告，用「哪些行是内容、哪些行是 API 逼出来的」逐段算账。结论：spec 形态删掉了旧报告的整段取数管道，API 主体成立；但试写暴露四个真实缺口，本轮裁决落进 docs。定稿在 `docs/feature/reports/library/{metric-views,entity-lists,metrics,recipes}.md`，场景行同批登记。

## 裁决

- **`pairsByFlag(name, { baseline? })`——DeltaTable 的派生配对形态**。现象：试写的 A/B 表要手抄 10 个 experiment id 字面量，而每一对都是「同配置开关 memory flag」的机械推论；加实验后报告静默缺行。文档反复强调「flags 即分组 API、报告不解析文件名」，唯独 A/B 声明退回字面量。裁决：配对域=同可比组 + 删除该 flag 后可比性配置深相等（复用 `current()` 的可比性字段集，不引入第二套比较规则）；a=baseline（缺省=未声明），b 侧每值一对；label 自动 `<a 末段> · <flag>=<显示键>`，要自定义 label 用字面 pairs；0 对是空态不是错误。
- **`FailureList` 官方组合件**。现象：`attemptListData → filter verdict → slice → data 形态` 这 8 行在 docs 里出现三遍、每个用户 repo 还要再抄。裁决：进工具箱成品件（verdict ∈ failed/errored、时间降序、limit 默认 20、total 报截断前总数），与手写组合严格等价、无私有能力；**不是**给 `AttemptList` 加过滤选项（那条第三轮已裁决维持）。docs 里的组合组件教学示例同批换成不与内建重影的「最贵 attempt」例。
- **非空元组按元素来源二分**。现象：`pairs: readonly [DeltaPair, ...DeltaPair[]]` 遇到 `.filter()` 产物必须写 `const [first, ...rest] = ...; if (!first) return null` 解构舞步。裁决：元素引用**运行时数据**的列表（`pairs`、`questions`）放宽为普通数组 + 空数组计算期完整用户反馈（运行期校验路径本就存在）；元素为**静态 import 实例**的列表（`metrics`、`columns`、`pages`）保留非空元组——它们天然字面量书写，编译期拒绝仍然免费。
- **`repeatedFailedCommands` 内置指标**。现象：试写的自定义指标（同 attempt 内同命令重复失败数）不是该 repo 特有，是 agent 效率通用指标族，`assistantTurns` 已开 o11y 先例。裁决：吸收为内置（每命令失败 n>1 记 n−1 求和，lower better，o11y.json，缺 artifact 显示缺失）。只收这一个：其余 o11y 派生量（工具调用数等）等真实需求出现再议，不预铺。

## 未采纳

- **DeltaTable 加「隐藏未命中 pair」选项**：试写时手写的 scope 过滤其实不必要——契约本就规定未命中侧显示缺失格、不静默删行，接受缺失格就是零代码；要隐藏就在组合组件里过滤（现有逃生门），不加旋钮。
