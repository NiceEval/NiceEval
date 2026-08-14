---
title: 'show 对 0.12 Record 只报 record-bootstrap-invalid，缺少迁移诊断'
severity: 'major'
---

## Expected Behavior

当前 CLI 遇到可由 0.12.1 读取的历史 Record 时，应区分「Record 不存在」「Record 无效」和「旧 schema 需要迁移或只读兼容」，并给出明确可执行的迁移或兼容提示。

## Current Behavior

在链接当前 NiceEval 工作树的 MemoryBench 2-0 中，无论使用默认路径还是显式传入旧 Record 根目录，`niceeval show` 都只返回 `record-bootstrap-invalid`。同一份历史仓库数据由 0.12.1 的 `niceeval show` 可以正常显示，因此调用者无法从当前诊断判断是路径错误还是版本迁移缺口。

## Possible Solution

在 Record bootstrap 边界识别旧 schema，返回专门的 typed error 和用户可执行的迁移命令；如果产品决定支持只读历史 Record，则让 `show` 走显式的只读兼容入口。

## Minimal Reproducible Example

1. 在链接当前 NiceEval 候选包的 MemoryBench 工作树运行：
   `pnpm exec niceeval show --record /home/ctrdh/Code/NiceEval/MemoryBench/.niceeval`
2. 观察当前 CLI 返回通用 `record-bootstrap-invalid`。
3. 在安装 niceeval 0.12.1 的 MemoryBench 主仓运行 `pnpm exec niceeval show`，同一历史数据可以生成经典报告。

## Context

该缺口阻断了用现有 MemoryBench 0.12 Record 对新 report/view 做完整下游 dogfood。本次遵守下游约束，没有直接读取 `.niceeval` 私有产物来绕过公开 CLI。
