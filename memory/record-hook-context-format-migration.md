---
format: niceeval.memory/v1
id: record-hook-context-format-migration
title: Hook Core 声明需要显式格式演进并保留历史证据
createdAt: 2026-09-13
kind:
  type: problem
  state: open
promotions: []
---
# Hook 声明进入严格 Core 后没有区分格式版本

新增 execution.experimentHooks 后，producer 写出的 0.15 历史 Run 被严格历史 codec 拒绝。合并后的候选通过公开 niceeval run list --json 读取真实旧 producer 产物时，报 Run does not match the exact niceeval.project-database/0.15 codec。

Root cause: 可选字段只允许新 reader 读取缺失值，不会使旧严格 reader 接受额外字段。历史迁移同时需要固定 schema 接纳和字段投影保留，不能只修其中一边。

设计由独立 Herdr design_grill 通过：新写入使用 0.18 与独立可写表；0.17 原样保留 Core、digest、seal；0.15/0.16 的合法 Hook 声明保留，缺失仍 unknown。旧 writer 隔离、可靠备份、事务回滚和外部原件保留继续由 SQLite adapter 保证。

公开回归由既有升级历史结果 Journey 拥有。正式红灯 nered_YEDRHD710BG8S7KD 来自真实 0.15 producer 与安装后候选，且清理通过。
