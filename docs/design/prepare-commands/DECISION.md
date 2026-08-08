**相关文档**:[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md)

---

## 已裁决的边界

以下三条随主题开题即定,任何候选都在其内:

- 执行模型不重开:逐 Attempt 重新执行、template owner 顺序、检查换 scope 是[Sandbox 模型 DECISION](../environment-model/DECISION.md)的裁决。
- 内置命令只能建在 `prepare()` 与 `defineSandboxCommand()` 之上;核心 Runner 不理解领域语义,不新增频次、scope 或按配对的守护表。
- fixture 物料沿用现有登记与上传,不建平行 API。

## 裁决

采纳 [PLAN-1](PLAN-1/README.md):官方内置命令库(`checkout()` / `installTool()`)加 `--dry` 复用成本视图。
定稿契约在 [Feature · 准备工具](../../feature/sandbox/prepare-commands.md);本页只保留选型理由。

## 为什么否决另两个候选

- **PLAN-2**:意图分类是 scope 选择的变体——作者又要为每条命令回答一次「它属于哪类」,错分类同样 fresh 无症状、复用爆发。框架还要理解命令语义才能兑现类别,与 Sandbox 模型否决统一 Layer 的理由同构。
- **PLAN-3**:C3 不满足,复用省不省只有跑起来才知道。identity 与检查样板在每个项目重复一遍,写错只有运行症状;官方也无法在 docs-site 给出稳定教学路径。PLAN-1 把同一份检查与缓存逻辑下沉一次,教学与身份口径随之统一。

## 翻案义务的履行

memory 旧裁决「不配官方 fixture 装载 API」(2026-07-29)已显式部分翻案,登记在 [prepare-commands-adopted](../../../memory/prepare-commands-adopted.md)。
新理由是复用缓存与稳定 identity;旧判据「不为自设地雷配绕行 API」保留在 api-design.md,`t.sandbox.cloneRepo` 一类 test 期装载 API 仍然不做。

## 遗留验证

PLAN-1 相对 PLAN-3 的增量成本是公开面维护;真实仓库(如 coding-agent-memory-evals)的复用成本实测归实现阶段验证,不改变契约形状。
