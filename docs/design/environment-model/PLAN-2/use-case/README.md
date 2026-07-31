# PLAN-2 用例覆盖

契约单源在 [Library](../library.md) 与 [Architecture](../architecture.md)。
本页只把根 [CASES](../../CASES.md) 的输入逐项代入单 template 与统一 Layer，并如实标出不能满足的验收条件。

状态含义：

- **支持**：本方案有完整声明入口、收敛路径和失败语义。
- **部分**：可以跑通一部分输入，但至少一条共同验收条件没有契约保证。
- **不支持**：缺少声明入口，或候选的固定规则直接与验收条件冲突。

## 覆盖矩阵

| Case | 状态 | 声明入口 | Base | 收敛路径 | 失败或缺口 |
|---|---|---|---|---|---|
| [C1 评估环境较重](../../CASES.md#c1评估环境较重) | 部分 | `eval.environment` | environment 归一出的单 template | Eval/Agent Layer 并行安装 | 完整 Compose Case 无表达位；不能归一时只有能力缺口 |
| [C2 实验环境较重](../../CASES.md#c2实验环境较重) | 部分 | `sandbox.template` + `experiment.layers` | Experiment template | manifest/`inspect` miss 后 install | 默认 manifest 不证明实际状态，也没有强制真实复检 |
| [C3 两边都较重](../../CASES.md#c3评估与实验环境都较重) | 部分 | `eval.environment` + `experiment.layers` | Eval template | Layer install | 没有宿主侧 `prepare`；离线 payload 只能在 install 中失败 |
| [C4 组合多个条件](../../CASES.md#c4组合多个条件) | 部分 | 多个 Layer，或手工合成一个 Layer | 既有 template | 全部 miss 并行 install | 无依赖和资源互斥；合并会丢失独立身份与复用 |
| [C5 预装稳定条件](../../CASES.md#c5预装稳定条件) | 部分 | 预制 template + 保留 Layer | 预制 template | manifest 或自定义 `inspect` 命中 | 过期 manifest 会假命中；起点变化可改身份但不补真实验证 |
| [C6 新 Sandbox 载入外部状态](../../CASES.md#c6新-sandbox-载入外部状态) | 部分 | Sandbox `.setup()` / `.teardown()` + `maxConcurrency: 1` | 每 Attempt 新 template | Layer 池结束后载入，销毁前回存 | 状态载入后没有三方真实最终屏障 |
| [C7 复用 Sandbox 活状态](../../CASES.md#c7复用-sandbox-活状态) | 部分 | C6 入口 + `sandboxReuse: true` | 每复用窗口一个 template | 每 Attempt 重读 Layer 检查 | manifest 会假命中,且没有 reuse key / window identity 契约 |
| [C8 Experiment 提供条件基底](../../CASES.md#c8experiment-提供条件基底) | 部分 | Experiment template + `eval.layers` | Experiment template | Eval Layer install | Eval 条件只有 install；无法安装时没有明确不兼容结果 |
| [C9 双方都有不可叠加基底](../../CASES.md#c9双方都有不可叠加基底) | 部分 | `templates[profile]` | map 指定的替代 template | Layer install | map 不承载完整融合 Case，也不分别验证双方要求 |
| [C10 混合批次](../../CASES.md#c10混合批次) | 不支持 | 普通 template、Eval environment、可选 `templates` | 按单槽位规则选择 | Layer install | 普通 template 与 Eval environment 双声明即冲突，违反默认起点让位规则 |

## 代表性判断

### C3 为什么只是部分支持

Eval environment 与 Experiment Layer 的二维组合不要求作者维护预制 template 笛卡尔积，这是本方案保住的部分。
但 Layer API 没有 `prepare`，无法在题面网络之外按目标平台准备并共享 payload；故意断网的题只能依赖预装，或在 install 阶段失败。

### C6 为什么可以支持

外部状态不是安装身份。
它继续由 Sandbox 状态 Hook 载入和回存，并用 `maxConcurrency: 1` 保护同一 Experiment 的临界区。
每条 Attempt 仍创建新 Sandbox，因此不需要为状态场景开启 `sandboxReuse`。

### C9 为什么 map 不是融合 Case

`templates[profile]` 只替换单个起点引用。
它没有 Compose 资源组、两份 Requirement、分别验证的结果或融合来源身份，因此不能证明 map 中的产物同时兑现双方条件。
