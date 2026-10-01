**相关文档**:[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [REVIEW](REVIEW.md)

# Decision

## 定案

Selected: [plan-1](plans/plan-1/README.md)

## 依据

Adapter 写入时为 `recordTrace` 事件附加封闭展示块，随事件封存。
`attempt.trace` 按 source family 分为 Events、Conversation、Commands 与 Diagnostics 四个 section，各有独立预算与状态。

G2: 设计保留了 C8 断言依赖的全部输出：section 标题与状态、每行一个 identity、五种稳定 ID 的展开，以及对位置 handle 的拒绝。Agent 体验在运行时是否退化，要在实现后用 C8 现有断言加大 outline、分页与 partial 空页回归证明，因此 G2 保持 pending。

- G3、G5 与 L1、L2 拉开差距。PLAN-1 读取路径不执行作者代码，Snapshot 换机后展示不变；PLAN-2 两者都不满足。
- G2 两个候选在 section 结构上相同，Agent 体验不取决于展示在哪里计算。
- PLAN-1 不需要对 [CLI Insight 裁决](../cli-insight/DECISION.md)翻案：作者交付数据而非 renderer，新增展示形状只能扩展 NiceEval 的穷尽 `kind` union。
- 外部轨迹（C9）用 `partial` collection、`external-trace` limitation 与 `text` 加 `code` 指引即可表达，不需要专门 kind。

## 独立审查与收敛

Codex `gpt-6-astra` 独立审查见 [REVIEW](REVIEW.md)：无 P0，五项 P1，三项 P2。主 agent 的处置：

| 编号 | 问题 | 处置 |
|---|---|---|
| R1 · P1 | Stable identities 合并成一行，C8 的逐行提取会失败 | 每行一个标签与一个 ID，按类型分组并报告遗漏，见 [plan-1 CLI](plans/plan-1/cli.md#outline) |
| R2 · P1 | section 的分页、预算与状态未定义；去掉 Agent 通用投影会丢失分页 | 四个 section 独立预算；四态状态且全部显示；Conversation 投影进 Events 保留分页；continuation 只推进 Events，见 [plan-1 Architecture](plans/plan-1/architecture.md#section) |
| R3 · P1 | `fields` 字符串没有预览形状，页预算未计入展示块 | `fields` 字符串值以 `PreviewText` 交付；单事件序列化投影 8 KiB，页预算按序列化投影计 |
| R4 · P1 | 图片校验失败被报成 `not-found` | 固定 descriptor 与 sha256，不符时返回 `inspection-record-integrity-failure`；补充解码失败、加载上限与读取预算 |
| R5 · P1 | revision 与 identity 表述歧义 | 区分执行资格、持久实体与内容完整性三类身份；`display` 作为 revision 1 可选字段，见下方实现修正 |
| R6 · P2 | `code` 宽度截断使命令不可复制；C3 缺读取命令 | 区分显示宽度省略与源文本遗漏；展开后 `code` 原样输出；图片展开给出 `attempt.artifact` 请求 |
| R7 · P2 | 终端安全处理范围不完整；“不影响 Verdict”过于绝对 | 安全处理作用于 Events 全部人读字符串并按码点进行；改为“不根据展示块评分”，未处理的拒绝按既有执行错误语义 |
| R8 · P2 | PLAN-2 评分有偏差 | L6、G4 改为 satisfied；L2 承认降级读取；G6、G7 改为 not-satisfied；formatter 时限改由 worker 线程兑现 |

L7 的设计缺口已由 R1、R2 的处置关闭，按设计充分性评为 satisfied；运行时验收归入 G2。

## 实现修正

采用时核对读取实现：attachment 的 family revision 必须与当前 revision 相等，否则读成 `unsupported`（`packages/niceeval/src/record/host/sqlite-host.ts`）。
审查后定下的 revision 2 会让全部历史轨迹不可读。因此按 [Adapters Architecture](../../feature/adapters/architecture.md#轨迹领域标识与持久格式) 中 header 扩宽的先例，`display` 改为 revision 1 的可选字段，不新增迁移。

## 否决项

[PLAN-2](plans/plan-2/README.md) 在读取时执行项目 formatter，属于 renderer 作者面，与 L1 冲突。
历史 Record 与 Snapshot 的展示随读取时的源码变化，打开他人 Snapshot 会执行当前目录的代码，G3、G5 不满足。
它能修正历史展示，但这项优势在本决策的目标权重下不足以抵消上述代价。

## 遗留风险

- 展示在写入时定型。Adapter 改进展示后，历史 Attempt 不重绘；如果用户普遍要求重绘旧结果，需要重新评估。
- 封闭词汇可能不够用（表格、音频、多图对比）。新增 `kind` 是 NiceEval 版本变化，需要 Inspection、`show` 与 View 同时实现。
- Adapter 可以写出与 payload 不一致的展示。NiceEval 不校验一致性；展示仅供人读，不参与评分。
- 采用到 Feature 后，实现必须先用 C8 现有断言与新增的大 outline、分页、partial 空页回归证明 Agent 体验没有退化。
