---
format: concord.document/v1
id: eval-environments-map-replaces-resolver
title: 环境映射从 experiment resolver 改为 sandbox spec 的 environments 数据表
createdAt: 2026-07-17T10:24:44+08:00
createdAtSource:
  kind: first-recorded
  path: memory/eval-environments-map-replaces-resolver.md
  commit: 52d4f9a416f9671329b801cb2959bdb3bae8a438
kind: memory
memoryKind: decision
state: captured
epoch: 0
promotions: []
history: []
---
# 环境映射从 experiment resolver 改为 sandbox spec 的 environments 数据表

**裁决（2026-07-17）**：`EvalDef.environment` 保留；`ExperimentDef.sandbox` 回到固定 `SandboxSpec` 单形态，`SandboxResolver` / `SandboxResolverContext` / `ExperimentSandbox` 删除。profile → 预制产物的映射改为三个内置 provider spec 工厂的 `environments` 数据表（docker `{ image }` / e2b `{ template }` / vercel `{ snapshotId }`），规划期查表派生 per-eval spec，选中 eval 的缺表项在创建任何沙箱前一次穷举报错。`sandboxResolverFingerprint` 随函数形态一并删除；`sandboxByEval` 只记声明了 environment 的选中 eval，顶层 `sandbox` 恒为基础 spec 投影。`defineSandbox` 自定义 spec 无 environments 表，配声明 environment 的 eval 按缺表项报错。

**曾选方案与否决理由**：

1. **resolver 函数**（a957d2f 落地形态，见 [eval-environment-profile-sandbox-resolver](eval-environment-profile-sandbox-resolver.md)）——映射是代码且每个 experiment 一份，维护面是 experiment × 环境；resolver `toString()` 哈希做快照配置身份太脆（改格式 = 配置变了）；映射写没写全要执行用户代码才知道。
2. **撤销 `eval.environment`、按环境拆专门 experiment**（本轮曾短暂裁决并开始改 docs，同日被用户以「分数不能统一展示」推翻）——一个逻辑配置（agent × model）的总分被拆进多个各覆盖子集的快照，view 文件夹对比里没有任何一行是全集 pass rate；实验文件数变成 agent × 环境组；任务需求从任务身上消失。
3. **config 顶层 environments 注册表**（profile → provider → 参数）——信息量与 in-spec 表等价，但注册表条目与 experiment 手里的 spec（hooks、资源参数）是两个对象，需要发明合并/override 协议；in-spec 表 + `Config.sandbox` 兜底已达成一次定义。
4. **环境 = 记忆化 setup**（eval 声明安装步骤，provider 首跑后自动快照缓存）——零映射的理想终态，但改不了基础 runtime（Python 3.9 不是 pip 装的），且要求每个 provider 都有快照机制；记为长期方向，未采纳。

**关键判据**：映射的真实维度是 profile × provider，与具体 experiment 无关，所以表应随 spec 复用而不是每实验复述；「统一展示」要求单 experiment 覆盖全部 eval，所以按环境拆实验不可行；数据表形态让缺项校验免执行用户代码、指纹按「该 eval 解析后的产物参数」精准计算（改别的环境条目不误伤）。

**落点**：`src/sandbox/types.ts`（三个内置 spec 的 `environments` 字段）、`src/runner/sandbox-selection.ts`（查表 + 穷举报错，替换 resolver 求值与函数指纹）、`src/runner/types.ts` / `src/index.ts` / `src/results/select.ts`（类型与导出面收缩）；契约在 `docs/feature/sandbox/library/prebuilt-environments.md#按-environment-选预制产物` 与 `docs/feature/experiments/library.md#不同-eval-起自不同预制环境`。
