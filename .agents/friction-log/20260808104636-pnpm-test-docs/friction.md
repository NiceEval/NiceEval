---
title: 'pnpm test:docs 被 sandbox registry 缺失 cases 声明阻断'
severity: 'minor'
---

## Expected Behavior

仓库提交的 src 测试文件在前 20 行声明对应 cases 文档，完整 pnpm test:docs 可用于验收纯文档改动。

## Current Behavior

src/sandbox/registry.test.ts 没有 cases 声明。完整文档套件稳定失败于 cases-registry.test.ts；本次相关的 writing、consistency、memory-index 与 svg-style 共 21 项均通过。

## Possible Solution

先核对 docs/engineering/testing/unit/sandbox.md 的覆盖规范，再在 src/sandbox/registry.test.ts 第一行加入指向该文档的 cases 声明。

## Minimal Reproducible Example

在仓库根运行 pnpm test:docs。守护报告 src/sandbox/registry.test.ts 前 20 行没有 cases 声明，并以 1 failed、23 passed 结束。

## Context

设计 Assertion Roadmap 的文档验收遇到该失败；目标文档没有修改 src/sandbox/registry.test.ts，因此本轮没有越界补写测试声明。
