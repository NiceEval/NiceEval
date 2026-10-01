# 在 Assertion 审计内封存费用

## Problem

Judge 的成功输出与失败传输都需要正式用量事实，现有审计已有物理序号。

## Core Mental Model

扩展每个审计的 transmission 回执，增加 Attempt 级 manifest 证明已检查所有审计。读取端汇总各 Assertion。

## Scope

不新增独立调用账本 family，但需要改变评分审计格式和 Attempt 完整性声明。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-既有运行边界) | satisfied | 原传输审计增加费用 | [生命周期](lifecycle.md) |
| [L2](../../LIMITS.md#l2-持久读取) | not-satisfied | 读全部审计，额外证明未调用 | [架构](architecture.md) |
| [L3](../../LIMITS.md#l3-费用事实) | satisfied | 单独协议映射 | [Library](library.md) |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-完整调用事实) | partial | 审计损坏会遮蔽用量 | [架构](architecture.md) |
| [G2](../../GOALS.md#g2-共用读面) | pending | 汇总后复用同一展示 | [Library](library.md) |
| [G3](../../GOALS.md#g3-可追查且有界) | partial | 大材料与费用共用审计预算 | [架构](architecture.md) |
| [G4](../../GOALS.md#g4-离线验收) | pending | 同一离线场景 | [Cases](../../CASES.md) |

## Entry Points

- [Library](library.md)
- [Architecture](architecture.md)
- [Lifecycle](lifecycle.md)
