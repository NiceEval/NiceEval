# 仅按实际模型汇总

## Problem

先消除用量展示中的空模型列，不增加用途配置与调用关联。

## Core Mental Model

只以现有 provider/model 和 route 分组。实验配置继续使用一个 model 或应用自己的 flags。

## Scope

变化仅限统一账本的读取投影与显示。应用费用与裁判费用的 producer 边界仍须完整，不从应用 flags 推断用途。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-现有物理调用边界) | satisfied | 直接消费现有调用 | 无新用途字段 |
| [L2](../../LIMITS.md#l2-当前配置与读取) | pending | 只补实际分组 | 无配置组合展示 |
| [L3](../../LIMITS.md#l3-独立成本账本) | pending | 裁判仍需发送证据 | 与用途关联无关 |
| [L4](../../LIMITS.md#l4-验收与权限) | satisfied | 中立离线验收 | 无付费调用 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-可解释的模型配置) | not-satisfied | 两用途共用模型时无法区分 | C1 不满足 |
| [G2](../../GOALS.md#g2-可核对的费用) | partial | 可按模型费用汇总，缺用途 | C2 仅部分满足 |
| [G3](../../GOALS.md#g3-唯一账本) | satisfied | 读取现有物理调用 | C3、C7 |

## Entry Points

- [Library](library.md)
- [Architecture](architecture.md)
