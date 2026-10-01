# 独立 Judge 账本

## Problem

Judge 已发送的失败和重试也会产生用量。Assertion 的评分结果不能证明物理调用与账单完整性。

## Core Mental Model

Attempt 持有一个 Judge 账本。每个 HTTP 请求在调用 fetch 前登记，收到有界响应后接纳用量事实，最终随 Attempt 一次封存。
Assertion 只提供稳定归属；评分审计与费用账本各自保留职责。

## Scope

涉及全部受管模型原语、Agent 与普通 Adapter、持久读取和展示。不新增应用侧上报 API，不更改应用费用口径。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-既有运行边界) | satisfied | 单一 HTTP 边界登记 | [生命周期](lifecycle.md) |
| [L2](../../LIMITS.md#l2-持久读取) | satisfied | 独立 family 与固定 cut | [架构](architecture.md) |
| [L3](../../LIMITS.md#l3-费用事实) | satisfied | 显式回执映射及估价证据 | [架构](architecture.md) |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-完整调用事实) | pending | 发送前登记，离线待验 | [C1–C6](../../CASES.md) |
| [G2](../../GOALS.md#g2-共用读面) | pending | 单一投影，离线待验 | [读面](library.md) |
| [G3](../../GOALS.md#g3-可追查且有界) | pending | 身份、预算和未知状态 | [架构](architecture.md) |
| [G4](../../GOALS.md#g4-离线验收) | pending | HTTP fixture 与旧候选红证据 | [C1–C11](../../CASES.md) |

## Entry Points

- [Library](library.md)
- [Architecture](architecture.md)
- [Lifecycle](lifecycle.md)
