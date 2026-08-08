**相关文档**:[README](README.md) · [GOALS](GOALS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [PLAN-6](PLAN-6/README.md) · [PLAN-7](PLAN-7/README.md) · [PLAN-8](PLAN-8/README.md) · [PLAN-9](PLAN-9/README.md) · [PLAN-10](PLAN-10/README.md) · [PLAN-11](PLAN-11/README.md)

---

## 目的

记载 Sandbox 模型必须服从的 Provider 原语、既有 Feature 契约与 setup 限制。
目标见 [GOALS](GOALS.md)。

## `SandboxTemplate` 不是单实例输出

单实例 Provider 通常从 image、template 或 snapshot 启动。
Compose case 还包含多个 service、网络、volume、ready 条件、主执行空间与整组回收。

统一不变量是“一条 Attempt 激活一个 logical SandboxTemplate，并读取到一个完整 `Sandbox Case`”，不是“所有 Provider 都只有同形的单实例输出槽位”。
Provider 不能合并两个起点输出；候选也不能用第二起点覆写表掩盖这项限制。

## 作者的 Sandbox 声明不是运行中的 case

EvalDef 或 Experiment 的 Sandbox 声明可以由具体 factory 提供起点；command-only 声明则没有起点。
该声明可以由 Eval 或 Experiment 作者编写,也可以由 benchmark adapter 从 task package 派生。

template factory 自带的 Provider planner 把它变成 Provider-native Case。
因此作者声明不是运行中的 Case，Eval adapter 也不能在起点之外再覆写 Provider。

## Provider 不能合并两个起点

Experiment 显式 template 可能预装昂贵工具,Eval template 可能携带题意。
Provider 没有通用原语把两份 image、template、snapshot 或 Compose 合并。

可行路径只有三类:

- 按 Eval template 自带的 Provider 构建并启动 `Sandbox Case`,再执行 Experiment command；此时 Experiment 不得再声明 template。
- Eval 没有 template 时,从 Experiment template 自带的 Provider 启动,再执行 Eval command。
- 现场组合不可行时,让恰好一侧改用已经融合条件的完整 template，并用 selector 形成合法 pair。

第三条显式暴露融合后的真实起点，不新建 pair override 表。

## Setup 有 owner 与顺序

Experiment 准备、Eval 准备与 Agent 安装已有不同的变化轴、归因与 teardown。
把它们压进通用 Requirement 数组会丢掉这些领域边界。

第一期按固定层次和声明顺序串行。
这是可读且可诊断的保守语义。
只有领域工具知道内部动作互不冲突时,才可以自行并行。

## Manifest 不是状态证明

template 名或受管 manifest 只能证明某次安装曾成功。
它不能证明二进制仍存在、PATH 与权限仍正确、动态库仍可用,也不能发现后续准备覆写了共享目录。

昂贵或预装条件应由领域工具检查实际 facts,缺失时安装并复检。
plain setup function 可以始终执行,但不能声称拥有预装命中语义。

## 身份分属两层

Experiment template、Experiment command 与 Agent 属于 Run 级配置；Provider 归唯一 template。
Eval Sandbox 声明、所选 case 与 Eval command 属于逐 Eval 身份。

不能用 `Function.prototype.toString()`、函数名或所谓静态 import closure 当 identity。
这里无法可靠证明 JavaScript callback 是否读取 `process.env`、时间或其他全局状态。

只有 `command()` / `shell()` 的纯数据声明，以及用 `defineSandboxCommand()` 显式登记 identity、revision 与 effective inputs 的工具，才具有稳定 identity。
直接传入的 callback 一律标记为 opaque，禁止跨 Run carry；候选若允许它影响可复用周期，还必须禁止跨 pair 或 invocation pooling。

## State 与 Agent runtime 正交

MemoryBench 需要外部记忆状态与复用周期。
这些事实约束完整 Attempt 生命周期,但不改变唯一 template 怎样读取成 `Sandbox Case`。

Sandbox 模型只为 state 与 Agent runtime 保留相位,不复制它们的公开类型。
多容器 case 的主 Sandbox、ready、证据与回收同样留在 Sandbox Feature。

## 动态本地依赖不能假装静态已知

Terminal-Bench 的本地测试文件在 `test(t)` 走到上传调用时才成为真实依赖。
任意 TypeScript 可以分支、循环或根据前序结果选择 source，Runner 无法在不执行代码时静态预知完整集合。

API 不为了缓存要求作者重复声明路径。
首次执行登记 transfer manifest；后续携带重算历史 source，源码闭包变化时直接重跑。

动态泄漏检查可以拒绝采信已经泄题的结果，但首次执行不能倒流阻止暴露。
需要保密时依靠物理目录隔离或 Provider filtered build context。
