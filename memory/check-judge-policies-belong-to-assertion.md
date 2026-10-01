---
format: concord.document/v1
id: check-judge-policies-belong-to-assertion
title: Judge 与普通检查共用 Assertion，门槛归本次验收
createdAt: 2026-09-13
kind: memory
memoryKind: decision
state: current
epoch: 0
promotions: []
history: []
---
## 裁决

`check(value, match)` 是统一的登记入口；`judge(value, definition)` 让受管模型调用在作者代码中可见，并薄包装相同的检查流程。Root、Turn 与 Session 都要求显式材料。工具包装默认选择 scope 的 toolCalls；Judge 没有唯一正确的默认材料，因此不隐式发送回答或整段对话。

Judge 与普通连续 Match 只定义评价量尺，不保存本次验收政策。measurement 的 `.gate(minimum)` 同时声明门槛与验收要求；`.score(points)` 按原始 measurement 贡献连续分值。Score Eval 可同时验收与计分，门槛失败仍保留已得到的分数，不能被报告、JUnit 或兼容投影改写为通过。

`.orStop(minimum)` 只设置停止条件；`.gate(minimum).orStop()` 重用验收条件。调用 stop 时同步完成校验并关闭该 entry 的配置窗口，重复无参等待复用同一个 Promise。共享停止状态不因 catch 或换 receiver 而恢复。删除只记录软门槛的 ScoreMatch/Judge `.atLeast()`，保留数字及工具次数比较中的 atLeast。

裸 measurement 与 Score 裸 Boolean 只记录，可用性政策为 optional；Pass 默认 Boolean 保持 required 与原有 optional 例外。gate、计分（含零分）与停止依赖要求可用结果。新 writer 封口明确的 requirement，旧 Record 按自己的字段解释，不从新 API 默认值重新推断。

## 理由

上一版把“得到评价值”和“决定本次是否合格”合并到 ThresholdedMatch，再要求无参 gate，迫使作者理解内部构造顺序。同一语法还使低于 atLeast 的计分条目继续贡献连续分数，容易误读为达标才得分。用户从天气回答检查指出这一矛盾，要求重审完整 check 与 LLM Judge 机制。

不合并 Pass 与 Score Eval：它们仍区分主要读数。两者共用检查、证据、验收政策和停止生命周期。只增加 gate 数参兼容糖会留下两个门槛来源，因此未采用。

## 设计挑战与证据

2026-09-13，独立 Herdr Astra design_grill 在问答裁决 Score 出口、requirement、停止配置窗口及软门槛取舍后给出 PASS。正式公开旧候选红灯来自提交 6ff241edc8098804d9d33eba720c33b4c52f488e 对应已构建候选：gate 数参被拒绝 nered_V2B7140698424BVV；连续计分与门槛/停止组合 nered_7JTK7AEM03V2XQGP；Judge 与 check 统一入口 nered_5WV8TF5QACQSMEEQ。

产品契约归 docs/feature/assertions/library.md、docs/feature/judge/library.md 与 docs/feature/verdict/architecture.md。本条仅保存设计取舍，不替代正式测试收据或功能契约。
