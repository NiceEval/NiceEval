# Feedback 与 Memory

Research、Memory 和本地 Issue 使用 Concord 当前文档模型。Issue 的字段、关系、关闭与修复核验按 `concord --skill feedback`，Memory 按 `concord --skill memory`；精确参数以各命令 `--help` 为准。

## Feedback

本地观察的唯一 owner 是 `docs/issues/<id>.md`，`concord issue` 与 Concord 页面读取同一批文件。旧 `feedback/<id>/README.md` 已通过一次性移动迁出，不保留第二份 owner。`source` 仅保存实际 GitHub／Linear 远端 provenance 快照。

关闭用 `concord issue close <id> --reason <text>`，修复缺陷用 `--fixed`。新公开工作项由 Issue 流程处理；本地创建、关闭或同步都不授权远端写入。

### 远端接入

在消费仓库配置 GitHub 读取范围：

```sh
concord feedback connection add --id niceeval-github --provider github --owner NiceEval --repo NiceEval --credential-env GITHUB_TOKEN
```

凭据只引用进程变量名。`concord feedback sync --connection niceeval-github` 显式读取远端。同步不是发布 GitHub Issue，历史 dev／dogfood 也不会被伪造为远端 Issue。

## Memory

`memory/<id>.md` 保存开发中可复用的经验；`memory/INDEX.md` 是人读导航。用 `concord memory search` 检索，用 `concord memory link` 关联到 Spec。

## 检查

运行 `concord check` 检查结构和关系。检查成功不等于原生 E2E 测试涉及范围或历史修复在当前工作区仍有效。

## 迁移审计

本次收据位于 `docs/migrations/concord-documents-20260914.json`，逐条保存原路径、目标路径、源 metadata 和正文摘要。它不是 runtime registry。历史 `feedback/migration-receipt.json` 与 `feedback/schema-v2-migration-receipt.json` 保持原 Git 时点语义，不改写为当前验证证明。
