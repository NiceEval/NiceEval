# 裁决:证据家族收敛为 registry 表,`has*` 布尔族换 `artifacts` 列表,o11y 正名派生缓存(2026-07-23)

**裁决**:attempt 级 artifact 的横切属性(词干、存储形态、类型、截断策略、`copySnapshots` 缺省、存在性声明)收敛为 `docs/feature/results/architecture.md#证据-registry` 一张表,writer / reader / copySnapshots / 截断 / `view --out` 复制全部由表驱动,新增证据 = 加一行。配套三项:① `AttemptRecord.hasEvents/hasTrace/hasSources/hasCommands` 四个布尔删除,换统一 `artifacts?: string[]`(词干列表,消解「四有二无」不对称);② `schemaVersion` 8→9(破坏性);③ `o11y.json` 移除 usage 与估算成本字段,只留行为计数,正名为「同版本派生缓存,删除可重算」——token/成本权威唯一在 `result.json` 的 `Usage` / `estimatedCostUSD`。传播落点见 `plan/evidence-registry-slice-components.md`。

**起因**:2c47312 的 `commands.json` 设计要同步八处清单(AttemptRecord 字段 / writeAttempt 参数 / reader 方法 / copySnapshots 联合与缺省表 / 截断适用范围 / view 导出清单 / 稳定契约清单 / concepts 词条),暴露「隐式表散布五处散文」;`has*` 四有二无只能靠「懒加载吸收」解释;usage 同一事实三份落点(Usage / o11y / show 组装)。

**曾选方案与否决理由**:

- 保持散文清单、只加 `hasCommands`——否决:第 N 种证据继续 O(清单数) 同步,第三方证据种类(multi-agent handoff、录屏、HTTP archive)无扩展点。
- 开放第三方 artifact 注册——本轮否决(留 roadmap):reader 方法与消费方是 typed core 面,没有消费方的落盘是死重量。
- `o11y.json` 整个删除——否决:行为计数被 `assistantTurns` 与 usage 行高频消费,`events.json` 重,缓存有真实收益;只删与 `result.json` 重复的 usage/cost,缓存契约(同版本、可重算、events 为准)写明。
