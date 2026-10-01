# 命名模型用途与物理调用关联

## Problem

配置描述预期，调用账本描述事实。缺少显式关联就无法判断哪个用途发生了模型回退。

## Core Mental Model

Experiment 保存命名模型用途；Adapter 读取冻结配置并在物理调用上报时引用用途键。
实际 provider/model 始终来自正式调用事实。Inspection 负责固定 cut 上的分组与费用完整性。

## Scope

公开配置、调用关联、Record 身份、Inspection 与展示属于本候选。
不改变模型路由，不复制应用请求正文，不推断 serving provider。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-现有物理调用边界) | satisfied | 扩展用途引用，不替换物理 callId | 设计约束 |
| [L2](../../LIMITS.md#l2-当前配置与读取) | satisfied | 保存规范配置，全部账本聚合后再预览 | Library 与 C9 |
| [L3](../../LIMITS.md#l3-独立成本账本) | satisfied | 应用费用保持，Judge 明示 unavailable | Library 费用缺口 |
| [L4](../../LIMITS.md#l4-验收与权限) | satisfied | 仅离线 fixture 与归档 | 验收约束 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-可解释的模型配置) | satisfied | 配置用途与实际调用关联 | C1、C2、C6 |
| [G2](../../GOALS.md#g2-可核对的费用) | partial | 应用按用途与币种统计，Judge 缺口明确 | C3、C4、C5 |
| [G3](../../GOALS.md#g3-唯一账本) | satisfied | 上报一次，多读面消费 | C7 |

## Entry Points

- [Library](library.md)
- [Architecture](architecture.md)
