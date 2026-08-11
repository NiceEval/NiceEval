**相关文档**:[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [PLAN-6](PLAN-6/README.md) · [PLAN-7](PLAN-7/README.md) · [PLAN-8](PLAN-8/README.md) · [PLAN-9](PLAN-9/README.md) · [PLAN-10](PLAN-10/README.md) · [PLAN-11](PLAN-11/README.md)

---

## 裁决

采纳 [PLAN-10](PLAN-10/README.md):Eval、Experiment 与 Agent 向同一个主 Sandbox 各贡献一层准备,每个实际配对恰好一方携带 template,固定 template owner 先、另一 owner 次、Agent 最后的顺序,普通 command 只有逐 Attempt 一种频次。

定稿契约写进 [Feature · Sandbox Layer](../../feature/sandbox/layers.md) 与 [Feature · Sandbox 三方准备时序](../../feature/sandbox/lifecycle.md);本页只保留选型理由。

## 命名裁决

采纳 PLAN-10 的语义,同时把公开词汇并回本主题共享文档已经使用的 template 词族:

- 作者声明类型是 `SandboxLayer`,分 template-bearing 与 command-only 两种形态,不使用 PLAN-10 文中的 root layer / extension layer。
- 弃用 root 的理由:`SerializableCommandOptions.root` 在同一作者面表示以 root 用户执行,一词两义;`sandbox.root-conflict` 读起来像权限错误。GOALS、LIMITS 与 CASES 通篇使用 template、command-only 与 template owner,错误码沿用 `sandbox.template-conflict` / `sandbox.template-missing`。
- 保留 layer 一词:它准确表达「向同一 Sandbox 叠一层准备、有起点的那层在最下面」的次序心智;它不是 Docker image layer,契约页写明这一句即可。
- 具体 factory 为 `dockerComposeSandbox()`、`dockerSandbox()`、`e2bSandbox()` 与 `vercelSandbox()`，它们产出 template-bearing layer。
- factory 名字同时点出 Provider;`sandboxLayer()` 产出 command-only layer,`localSandbox()` 同样是 template-bearing factory。
- 方法名沿用 `.prepare(command)` 与 `context.onCleanup()`;`workspaceService`、`SandboxCommand`、`SandboxCommandTarget`、`AgentProvisioner`、`agentSandboxLayer()` 不变。

## 关键裁决

- Eval 与 Experiment 使用同一个可选 `sandbox` 字段声明 `SandboxLayer`;字段所在位置决定 owner,不表示创建两份 Sandbox。
- template-bearing factory 原子绑定完整起点与 Provider;共享接口只有 command 链,没有 `.template()`、`.provider()` 或可写 template 属性。
- 对 Sandbox Agent,每个实际选中的 Eval × Experiment 配对恰好一方 template-bearing。两方都是报 `sandbox.template-conflict`,两方都不是报 `sandbox.template-missing`;错误全矩阵聚合,零 Provider I/O、零资源创建。
- 同一 Run 允许多个 template;唯一性是配对局部约束,混合批次不按 Provider 拆分 Experiment。
- 顺序只有一条:template owner 的 command 先执行,另一 owner 随后,Agent 安装最后;同一 layer 内按书写顺序;没有 priority、dependsOn、资源锁或自动并行。
- 普通 command 只有逐 Attempt 的 `prepare()` 一种频次;fresh 与 reuse 都完整重新执行,昂贵动作靠真实检查快速命中。
- cleanup 在 command 成功取得资源后经 `context.onCleanup()` 就地登记,按全局准备顺序逆序执行;未执行的命令不产生虚假 cleanup。
- `runCommand` / `runShell` 非零退出默认失败;预期非零的探测显式使用 `tryCommand` / `tryShell`。
- `command()` / `shell()` 携带纯数据 identity;直接传入的 callback 一律 opaque,禁止跨 Run carry;稳定工具用 `defineSandboxCommand()` 显式登记 identity。
- Agent layer 排进同一条时间线的最后一位,但保留 `AgentProvisioner` 完整协议,不降格成普通 command;Adapter 不能提供 template 或 Provider。
- 现场无法组合时,恰好一侧改用已经融合条件的完整 template,另一侧保持 command-only,用 selector 形成合法配对;Runner 不合并两个起点,也没有第二起点覆写表。
- `niceeval check`、`--dry` 与正常运行消费同一份 linked matrix;fingerprint、build 与 Attempt 不各自重算 template 选择。
- Eval 的机械准备只有两处:layer 的 `prepare()` 与 `test(t)` 普通代码;EvalDef 不设 setup / teardown 字段,回收经 `context.onCleanup()` 表达。
- 生命周期 phase 记 `sandbox.prepare` 与 `sandbox.cleanup`,诊断按 owner 细分(如 `sandbox.prepare.eval`);Agent Ensure 记 `agent.provision`,Agent runtime setup 记 `agent.setup`。

## 为什么不是 PLAN-9

PLAN-9 与 PLAN-10 共享同一个正确内核:统一 `sandbox` 字段、factory 原子绑定起点与 Provider、配对级 XOR、创建资源前全矩阵聚合报错、checked command 与 opaque callback 规则。两者对照 GOALS 十三条需求都成立,差别集中在普通 command 的频次模型。

PLAN-9 给普通 command 两种 scope:`setup` / `teardown` 每复用周期一次,`beforeEach` / `afterEach` 逐 Attempt。否决理由有三条:

1. **scope 选错是潜伏缺陷。**默认 fresh 模式下复用周期与 Attempt 语义完全重合,放错 scope 毫无症状;打开 `sandboxReuse` 后才以复用污染或题目准备缺失的形式爆发,爆发点离写错的那行很远。PLAN-10 只有一种频次,fresh 与 reuse 的行为差异只剩 reset 加检查命中,没有这条延迟引爆线。
2. **检查的成本两个方案都要付,scope 的成本只有 PLAN-9 付。**LIMITS 要求预装与昂贵条件必须真实检查,PLAN-9 的周期 setup 同样要验版本、PATH 与权限。既然 ensure 式写法逃不掉,PLAN-10 用它换掉了 window scope、reset anchor、`windowStackIdentity` / `opaqueWindowSalt` 与四元 pool key 这一整片规格面。PLAN-9 的这套身份机制是为「周期跳过执行」而存在的正确性负担;PLAN-10 从不跳过执行,负担整块消失。
3. **reset anchor 的承诺超出 Provider 能力。**anchor 声称涵盖两方 setup 的变化,但 Attempt 对 workdir 外的污染无法由 workdir reset 恢复;PLAN-9 靠「无法恢复已知状态时退休复用周期」收口,而「无法恢复」本身不可判定。PLAN-10 每条 Attempt 用实际检查重新面对现状,漂移由检查暴露,与 LIMITS「Manifest 不是状态证明」同向。

PLAN-9 剩余的独有能力是作者级「每复用周期恰好一次且不可重复」的动作。PLAN-10 的回答是这类动作归 Provider Case 或 State Feature,不属于普通 layer;这是归位,不是缺失。

## 为什么不是 Requirement 族(PLAN-4 / PLAN-11)

PLAN-11 是这一族的最完整形态:修掉了 PLAN-4 的 C10 缺口,state、隐藏判分与两层不兼容都闭合。整族仍被本主题的定稿条款排除:

- GOALS 设计原则写明不再建立通用 Environment contribution,也不自动推导 setup 依赖、资源锁或并行调度;这一族的核心正是 `EnvironmentContribution` 与 `dependsOn` / `resources` 调度图。
- LIMITS 写明融合路径是「恰好一侧改用融合条件的完整 template」,不新建 pair override 表;这一族靠按 profile 的融合 `cases` 表。
- CASES C10 要求缺 template 的 Eval 报 missing;这一族用默认 case 静默补位。C11 拒绝文件专用 field 与特殊 callback;PLAN-11 有受管 hidden verifier 相位。
- PLAN-11 还把 state checkpoint 后继策略与 Agent runtime 拆段吸进本主题,而两者都是 GOALS 明列的非目标。

## 其余候选

- **PLAN-1**:安装内容按出处分六个去处,`provisions` 是有序数组,template 入口有三处;详见其 README 的缺点清单。
- **PLAN-2**:统一 Layer 只保留各安装领域的交集,Compose 拓扑、Agent staged payload 与真实检查都被删除;简洁来自删除领域义务。
- **PLAN-3**:不对称模型,Experiment 永远不能提供起点,C8 无法表达;是 PLAN-4 的真子集。
- **PLAN-6 / PLAN-7 / PLAN-8**:通往 PLAN-9 的演进链,分别贡献了唯一起点读取、普通文件传输与 transfer manifest、Environment 与 owner 正交的修正;各自被后继者取代,贡献已被 PLAN-9 与 PLAN-10 吸收。

## 真实仓库证据

Terminal-Bench 的每道题自带 Compose,题目 Sandbox 归 task package;Eval 用 `dockerComposeSandbox()` 声明起点,Experiment 不感知题目用哪个 Provider,混合批次逐配对读取。MemoryBench 反向:Experiment 用 `e2bSandbox({ template })` 提供起点与 mempal 准备,Eval 用 command-only layer 逐 Attempt checkout 固定 commit。两条真实路径都只需要「一方带 template、双方各叠一层命令」这一个模型。
