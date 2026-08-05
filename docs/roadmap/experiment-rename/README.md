# 实验改名与结果重绑（Experiment Rename）

题目（Eval）可以跨多个 Experiment 共享；Experiment 的 id 今天等于 `experiments/` 下的路径。
把 `experiments/codex.ts` 改成 `experiments/codex-5.6-luna.ts` 时，**不是**「同一条件换了个标签」，而是**新开了一个 Experiment**：落盘目录、Session 选择、carry 规划、报告分组全部按新 id 走，旧目录下的终态结果默认看不见、也不会被自动携带。

下游（Terminal-Bench、MemoryBench）经常在「模型 / 条件已经钉死」之后才想把实验文件改成可读名字（例如 TB 的 `codex` → `codex-5.6-luna`，与 `model: "gpt-5.6-luna"` 对齐），同时**不想付全量重跑的钱**。
今天没有一等公民的改名路径：人只能手挪 `.niceeval/<oldId>/`、改 JSON 里的 `experimentId`，或在旧 id 仍存在时对每条 locator 做 `accept`——且 `accept` 契约要求「当前仍发现**同一** experiment」，改名后旧 id 消失则 accept 直接不可用。

本主题补「**显式、可审计的实验身份迁移**」，把「换文件名」从「等价于新建实验并丢弃历史」变成「可选的、授权的重绑」。

## 解决的问题

| 场景 | 今天 |
|---|---|
| TB：`experiments/codex.ts` 已钉 `gpt-5.6-luna`，想改名为 `codex-5.6-luna` | 文件一改，`.niceeval/codex/**` 与新 id 脱钩；下次 `exp codex-5.6-luna` 全量重跑 |
| 多实验共享同一批 `evals:` 前缀 | Eval 源码与指纹不变，**变的只有 experiment 坐标**；却与「改 model」一样贵 |
| 报告 / `show --exp` / labels 线 | 新 id 是空历史；旧 id 结果还在磁盘上但 selector 对不上 |
| `niceeval accept @loc` | 重锚的是**指纹**，前提是 experiment 仍被发现且与 locator 同源；**不是**跨 experimentId 搬家 |
| 手改落盘 | 易漏 `run.json` / manifest / locks / 报告站点路径，无审计字段 |

不把「改名」混进普通 carry：carry 的语义是「同一实验身份下输入未变」；改名是**人承认新旧 id 表示同一实验条件**，必须显式、可审计、默认可逆。

## 核心心智

- **Eval 身份**：`evalId` + 源码闭包 + 运行配置进入 fingerprint 的部分。题目共享时，多条 Experiment 可以选中同一 eval。
- **Experiment 身份**：`experimentId`（路径）是结果树、Session、报告、锁的命名空间；**默认进入「结果归属」而不进入 eval 内容指纹**（指纹里是 agent 名、model、flags 等解析值，见 [缓存与携带](../../feature/experiments/cache.md)）。
- **改名（rename）**：在**不改变**解析后的运行配置（或配置变化已单独用 accept 处理）的前提下，把历史结果的**归属坐标**从 `oldExperimentId` 迁到 `newExperimentId`，使新 id 的下一次规划可以 carry。
- **与 accept 的分工**：
  - `accept`：同一（或仍可解析的）实验下，**指纹变了**但人认定结果仍成立 → 重锚指纹。
  - `rename`（本主题）：**实验 id / 落盘路径变了**，配置与 eval 集合仍对应 → 重绑归属。
  - 两者可组合：先 rename 再因 flags 微调而 accept；或 rename 时若配置也变了则拒绝并提示先对齐配置或分两步。

## 候选契约

### 命令表面（推荐）

```bash
# 预览：会迁多少条、哪些 eval、是否配置漂移
niceeval exp rename codex codex-5.6-luna --dry

# 执行：显式新旧 id；要求新实验文件已存在且可发现
niceeval exp rename codex codex-5.6-luna

# 机器面
niceeval exp rename codex codex-5.6-luna --json
```

或独立子命令 `niceeval rename-experiment`（待裁决）。挂在 `exp` 下更贴近「实验坐标」心智。

### 前置条件（全部满足才写盘）

1. **源** `oldId` 在记录根下有至少一条可读终态历史（passed/failed；errored 策略见下）。
2. **目标** `newId` 已被当前项目**发现**为 Experiment（新文件已就位：`experiments/codex-5.6-luna.ts`）。
3. **配置对齐门**（核心）：对 `oldId` 历史结果用的配置身份 vs 当前 `newId` 解析出的配置，按与 carry 相同的 fingerprint / manifest 比较：
   - **match**：允许 rename 携带；
   - **changed** 且仅 `experimentId`/路径类非指纹字段：允许；
   - **changed** 且 model / agent / flags / eval 源等指纹输入不同：**默认拒绝**，提示先改配置对齐或对差异子集 `accept`；
   - 可选 `--force-config-drift` 写入并在每条结果记审计（待裁决是否提供）。
4. **Eval 集合**：仅迁移 **newId 当前仍选中** 的 evalId；旧实验多出来的 eval 列出警告，不静默丢弃也不迁入。
5. **目标冲突**：`newId` 下已有同 eval 终态时默认拒绝覆盖；`--prefer=source|target` 或逐条策略待裁决。

### 写盘语义

- 为 `newId` 合成 **一个**（或按 run 边界多个）新 snapshot / 结果树，**不**原地改写旧目录为唯一真源（旧树保留只读，或标记 `supersededBy`——待裁决）。
- 每条迁入结果：
  - 保留 verdict、证据、artifact 引用（或复制/硬链 artifact，保证 `show` 可读）；
  - 使用 **newId** 与当前指纹；
  - 记录 `renamedFrom: { experimentId, locator, fingerprint?, at }`（与 `acceptedFrom` 并列的审计字段）。
- 不迁移：locks 活锁、active Session、进行中的 run、sandbox 实例。
- errored / skipped：默认不迁（与 accept 一致）；可选 `--include-errored` 仅作档案（不可 carry）待裁决。

### 发现与路径

- 推荐工作流（TB 例）：
  1. 复制或 `git mv experiments/codex.ts experiments/codex-5.6-luna.ts`，必要时删旧文件；
  2. `niceeval exp rename codex codex-5.6-luna --dry`；
  3. 确认配置 match 后正式 rename；
  4. `niceeval exp codex-5.6-luna --dry` 应显示大量 carried。
- 若旧文件仍在：`oldId` 与 `newId` 同时可发现；rename 不删除旧实验源码，只迁结果坐标。人之后自己删旧文件。

### 报告与站点

- rename 后 `show --exp newId` / 报告 labels 走新 id。
- 旧 id 目录若保留，历史对比需显式 `--exp old --exp new` 或文档说明「已 superseded」。

## 范围

**包含**

- 实验 id 级结果重绑的 CLI 与审计字段
- dry 计划与配置对齐门
- 与 accept / carry 的边界说明

**不包含**

- Eval 改 id / 搬目录（另题）
- 自动 `git mv` 实验源码
- 静默把任意两个实验的结果合并（必须显式 old→new）
- 改变 fingerprint 算法本身
- Memory 条件 cohort / checkpoint 文件的自动改名（mempal tgz 等由作者自行处理或后续主题）

## 与 TB 场景的贴合

Terminal-Bench 现状：`experiments/codex.ts` 已 `model: "gpt-5.6-luna"`，结果在 `.niceeval/codex/`，evals 为 `terminal-bench/` 共享前缀。

| 步骤 | 是否需要本功能 |
|---|---|
| 只改 `description` / 注释 | 不需要（指纹不动） |
| 改文件名对齐 `codex-5.6-luna` 并保留结果 | **需要** rename |
| 改 model 字符串 | 不走 rename；走指纹 stale + 可选 accept |
| 新建并行实验对比两模型 | 不需要 rename；两 id 两套结果 |

## 待裁决分歧

1. 命令名与挂载点：`exp rename` vs `rename-experiment` vs `results rebind`。
2. 旧树：保留只读 / 移动 / 写 `supersededBy` 后允许 GC 命令。
3. 配置漂移：`changed` 时硬拒绝 vs 允许并强制审计。
4. 目标已有结果时的冲突策略。
5. `renamedFrom` 是否进入公开 Record schema（升 schemaVersion）还是仅 CLI 侧 sidecar。
6. 是否一次支持「多 old → 一 new」或「一 old 拆多 new」（首版建议 **一对一**）。
7. 与 Graphite/PR 工作流：是否提供「只生成 migrate 计划、由 CI 执行」的纯 dry 退出码约定。

## 实现体量判断（是否派 subagent）

| 工作 | 建议 |
|---|---|
| **本 roadmap 文档**（问题、契约、分歧） | **主 agent 直接写**（上下文已在：carry/accept/TB 路径）；不必为文档再派 subagent |
| **实现 rename CLI + 单测 + dry 计划** | 适合 **单独 worker**：边界清晰（读 record 根、写 snapshot、审计字段），可按 `docs/roadmap/experiment-rename` 验收；实现前先定稿「配置对齐门」与「旧树策略」 |
| **TB 仓库内实际改名** | 下游小改：等 NiceEval 有 rename 或接受「一次性手迁」；**不要**在 TB 用脚本改 JSON 当长期方案 |

结论：**设计进 roadmap 由主会话完成；实现可派 subagent，但应在分歧 1–3 有用户拍板之后**，否则 worker 会在「硬拒绝 vs force」上猜。

## 成功标准（设计层）

1. TB 将 `codex` 文件改名为 `codex-5.6-luna` 后，一条 rename + `exp --dry` 显示历史 passed/failed 为 carried，而不是 200+ new。
2. 若误把 model 从 luna 改成另一模型再 rename，命令拒绝或明确标漂移，不把不可比结果装成 carry。
3. 每条迁入结果可在 `show` 追溯 `renamedFrom` / 与 `acceptedFrom` 区分。
4. 不发明第二套 fingerprint；题目共享语义保持「eval 共享、experiment 分桶」。

## 入口

- 本文件
- 相关定稿：[缓存与携带](../../feature/experiments/cache.md)（文件名即 experimentId；accept 边界）
- 相关 roadmap：[结果携带与 Sandbox 复用反馈](../reuse-feedback/README.md)（`carried` 用词；不覆盖改名）
