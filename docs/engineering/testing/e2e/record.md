# 功能域 · Record

本域只拥有明确公开的 `niceeval/record` API 与 [Record Format](../../../feature/record/architecture.md)。
它由 `e2e/record/` 功能 Repo 承担；manifest 的 `areas` 包含 `record`，并进入无密钥 PR lane。

## record-public-api-roundtrip

此 owner 通过候选 tarball 的公开 writer 与 reader 完成一轮写入和读回；边界与验收命题如下。

## 公开边界

- 从候选 tarball 的公开 `niceeval/record` export 进入，不 import 根 `src/` 或内部子路径；
- 公开格式 fixture 的 schema version、字段与 expected 是签入字面量，不从候选常量生成；
- `openRecord()`、`current()` 与公开 writer 的结果按契约断言；
- 未逐项声明的 `.niceeval` 目录位置、临时文件、分片与索引布局属于私有实现；
- 私有布局可以作为 diagnostic artifact 收集，但不决定 verdict。

## 验收命题

公开格式 owner 验证 Run、Attempt、diagnostics、events、sources 与 tracing 字段的版本和关系。旧格式兼容性使用最小签入 fixture，
并把版本写成独立字面量。malformed fixture 必须停在公开 reader 的错误边界，不能回退到模糊 substring。

Report Repo 只消费公开 Record API 或公开 CLI 产生的事实，不直接读取 `run.json`、`result.json`、`events.json` 等私有路径。
只改变私有存储组织或 reader 内部 DTO 属于公开契约不变的内部重构；Record 与 Report owner 不应因此改变。

## 稳定性归属

本页只界定公开边界与 owner，不另设一套无法读取 PR diff 的执行规则。
测试变更预算及 perturbation / mutation 收据统一由
[Pullfrog review prompt](../../../../.github/pullfrog-review-prompt.md#prompt)逐文件审计。
不满足时在唯一持续审查报告中列为阻塞问题，最终态标为“需要修改”；不创建 GitHub review event 或源码行评论。
