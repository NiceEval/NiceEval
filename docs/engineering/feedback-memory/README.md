---
format: concord.document/v1
id: feedback-memory
title: Feedback 与 Memory
createdAt: 2026-08-23T12:48:57+08:00
createdAtSource:
  kind: first-recorded
  path: docs/engineering/feedback-memory/README.md
  commit: 7871a6b3939fef8c750ce18e733603a40afa22c7
kind: engineering
---
# Feedback 与 Memory

Research、Memory 和本地 Issue 统一使用 Concord 最新文档模型。类型与严格 Schema 由锁定包的 `concord-sdlc/model` 导出。普通命令只读写 `concord.document/v1`，不读取旧格式或维护历史兼容列表。

## Feedback

本地观察的唯一 owner 是 `docs/issues/<id>.md`，`pnpm feedback` 与 Concord 页面读取同一批文件。旧 `feedback/<id>/README.md` 已通过一次性移动迁出，不保留第二份 owner。`origin` 保留 dev／dogfood provenance，`source` 仅保存实际 GitHub／Linear 远端provenance快照，二者不互相冒充。

`memoryRelations` 条目 investigation、root-cause、decision、delivery 角色和 canonical Memory 路径。`adoptions.current/history` 保存精确契约引用及退役历史。反向关系统一派生，不另建注册表。

### 关闭规则

`closure` 保存 fixed、delivered、duplicate、declined、invalid、external-fixed 或普通 closed 原因。fixed 关联已条目 fixed resolution 的 Problem；delivered 关联交付 Memory 与已采用目标；declined 关联当前 Decision；duplicate 指向唯一 canonical Issue。duplicate／declined／invalid 前须明确退役 current adoptions。历史关闭声明不会生成新的执行证据。后续问题重开不静默改写 Issue 历史。

`pnpm feedback close --help` 给出各 kind 的具名参数。新公开工作项由 Issue 流程处理；本地创建、关闭或同步都不授权远端写入。

### 远端接入

在消费仓库配置 GitHub 读取范围：

```sh
pnpm exec concord feedback connection add --id niceeval-github --provider github --owner NiceEval --repo NiceEval --credential-env GITHUB_TOKEN
```

凭据只引用进程变量名。`pnpm exec concord feedback sync --connection niceeval-github` 显式读取远端。同步不是发布 GitHub Issue，历史 dev／dogfood 也不会被伪造为远端 Issue。

## Memory

`memory/<id>.md` 保存 Problem、Decision、Insight 或 Note；`memory/INDEX.md` 是人读导航，机器发现来自 owner metadata。类型明确但当前状态未知时保存 captured，不能默认断言已采用或仍开放。Note 只允许 captured；具名 `memory activate --reason` 可将已分类条目激活为 open 或 current。captured 不满足 fixed 或 promotion 门槛。

Problem 可为 open、`resolved`、captured 或 superseded；Decision／Insight 可为 current、captured 或 superseded。superseded 表示已不再适用，不表示已修复。未知替代目标保留原声明和provenance，不猜测正文中任意链接。

### 作者区域

最新 frontmatter 拥有状态、关系、epoch 和历史；正文是完整作者区域。`author set` 以 preimage 摘要保护修改，保留 metadata history。普通 reader 不识别旧正文历史标记；一次性迁移保留原作者字节与审计provenance。

## E2E regression

`command`、`repository`、`attested` 是不同证据等级。Concord 通用 fixed 必须有自己签发的当前 red／green command 收据。Repository fixed 验证实际 formal receipt、inventory、certificate 和六条 reliability 收据后，在独占锁内绑定当前 Memory epoch。

Repository epoch 表示核验与绑定时的生命周期，不声称 runner 在该 epoch 签发；候选只表示 green 和 reliability 一致，不能据此证明当前工作区。reopen 增加 epoch，完整旧 resolution 入 history；已使用 invocation 不得被换路径复用。原条目声明已修只迁为 attested，始终未验证，不能满足新的 fixed gate。

## 命令与一致性

`pnpm memory`、`pnpm feedback` 和 `pnpm exec concord` 共用当前 schema。读、写、检查、迁移及恢复共享同一 publication lock；发现未完成 journal 时先按具名错误恢复。dry-run 不写用户文件或证据缓存，可以建立 Git-private 协调锁文件。

使用 `--help` 获取当前具名参数；运行 `pnpm memory check`、`pnpm feedback check` 与 `pnpm exec concord check` 检查结构和关系。检查成功不等于原生 E2E 测试涉及范围或历史修复在当前工作区仍有效。

## 迁移审计

本次收据位于 `docs/migrations/concord-documents-20260914.json`，条目每条原路径、目标路径、源 metadata 和正文摘要。它不是 runtime registry。历史 `feedback/migration-receipt.json` 与 `feedback/schema-v2-migration-receipt.json` 保持原 Git 时点语义，不改写为当前验证证明。
