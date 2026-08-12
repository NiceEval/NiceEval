# Goals

**相关文档**：[README](README.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md)

## 目的与范围

本设计比较 Record 持久层之上的全部公开 API。Record portable Core 与 Run/Attempt owner 不在
候选范围；Record 的 open/read DX 可以重做。PLAN-1～4 也固定 Attachment schema 与 migration
bytes，PLAN-5 单独挑战七个 Observability families 的未来 inventory/schema。

## 设计目标

- **G1 — 一条自然路径。** 作者从 Record root 到页面结果只学习一套连贯调用关系，不手工跨层搬运中间协议。
- **G2 — 分母可靠。** expected slots、excluded、not-recorded 与 core-invalid 不会因查询写法消失。
- **G3 — Lineage 明确。** selected Run、referenced Attempt 与 origin Run 的读取不能依赖隐式默认值。
- **G4 — 状态穷尽。** unavailable、migration-required、migration-unavailable、unsupported 与 invalid 保留为数据状态。
- **G5 — 普通用例短。** Attempt 详情、通过率和成本不要求作者手工 join 多份数组。
- **G6 — 复杂用例可扩展。** 自定义 Attachment、跨字段派生、动态详情页与机器可读下载有公开路径。
- **G7 — 共享与隔离。** 共享取数至多执行一次；一个派生或页面失败不应无条件抹掉无关页面。
- **G8 — 同源交付。** terminal、web 与 static 消费同一 immutable execution，不各自查询或重算。
- **G9 — 官方无特权。** Built-in Report 只能使用用户可调用的公开数据 API。
- **G10 — Record 可证伪。** 候选必须指出哪些需求仅靠现有 Record reader 无法实现，不能把底层缺口伪装成上层 DX。
- **G11 — 物理与关系分离。** 若采用 PLAN-5，package schema 跟随事实权威与 seal transaction；单包
  Projection 和跨包 Relations 分别拥有可执行的不变量。

## 评价原则

调用点清晰、概念数量、错误局部性与错误数字的可防止程度，比单纯代码行数更重要。候选可以明确
不满足某个 Case，但必须说明代价，不能在自己的用例中降低验收标准。

G7/C4b 同时是三层或四层的评价 gate。若局部失败与跨 consumer 自动去重成为硬产品契约，只有具备
managed Derivation 的四层候选合格；在裁决前，三层候选可以明确用 report-level failure 换取更低复杂度。
