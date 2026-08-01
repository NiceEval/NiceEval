# prepare-commands 定稿:内置 checkout / installTool 命令与 --dry 成本视图

## 裁决

2026-08-01,prepare-commands 主题采纳 PLAN-1:`niceeval/sandbox` 提供内置 prepare 命令 `checkout({ repo, ref })` 与 `installTool({ tool, identity, probe, install })`,全部是 `defineSandboxCommand()` 封装;`--dry` 对复用 Experiment 逐命令展示成本类别(检查命中型 / 每题重放)。Runner 与 SandboxLayer 协议零改动。定稿契约在 `docs/feature/sandbox/prepare-commands.md`,选型理由在 `docs/design/prepare-commands/DECISION.md`。

## 曾选方案

- PLAN-2:SandboxCommand 意图分类字段(materialize / install / probe),框架按类别推导缓存。
- PLAN-3:零新 API,检查与缓存惯用法进文档。

## 否决理由

- PLAN-2:分类是 scope 选择的变体,错分类同样 fresh 无症状、复用爆发;框架要理解命令语义才能兑现类别,与环境模型否决统一 Layer 的理由同构。
- PLAN-3:C3(计划面成本可见)不满足;identity 与检查样板在每个项目重复,写错只有运行症状,官方也无法给出稳定教学路径。

## 命名裁决

同批弃用 helper 与 ensure 两个名字:helper 是口袋词,ensure 与术语表已有的 Agent Ensure 撞概念。品类定名「内置 prepare 命令」(与内置 Provider 平行),函数按动作与对象命名 `checkout` / `installTool`,字段 `id` 改 `tool`。

## 翻案关系

部分替代 [[no-official-fixture-loading-api]](2026-07-29):当时否决官方 `cloneRepo` 的判据是「不为自设地雷配绕行 API」,地雷(沙箱内框架文件)已拆;本次采纳的动机是复用缓存与稳定 identity,属于当时未评估的新事实。判据本身保留在 api-design.md;`t.sandbox.cloneRepo` 一类 test 期装载 API 仍然不做——`checkout()` 是 prepare 相位的 layer 命令,不是 test 期 API。
