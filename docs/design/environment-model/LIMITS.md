**相关文档**:[README](README.md) · [GOALS](GOALS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [PLAN-5](PLAN-5/README.md) · [PLAN-6](PLAN-6/README.md) · [PLAN-7](PLAN-7/README.md) · [DECISION](DECISION.md)

---

## 目的

记录环境模型必须服从的 Provider 原语、既有 Feature 契约与 setup 限制。
目标见 [GOALS](GOALS.md),结论见 [DECISION](DECISION.md)。

## Sandbox 起点不是统一 template

单实例 Provider 通常从 image、template 或 snapshot 启动。
Compose case 还包含多个 service、网络、volume、ready 条件、主执行空间与整组清理。

统一不变量是“一条 Attempt 解析到一个完整 Sandbox Case”,不是“只有一个 template 槽位”。
Provider 不能合并两个起点产物,但 `environments[profile]` 可以选择一个预制完整 case。

## Eval Environment 不是运行中的 case

EvalDef 可以携带 profile 或 folder-local source。
该值可以由 Eval 作者声明,也可以由 benchmark adapter 从 task package 派生。

只有当前 SandboxSpec 的 `environments` 表或 materializer 能把它变成 Provider-native case。
因此 source 不是 Eval Base,adapter 也不能选择 Provider。

## Provider 不能合并两个起点

Experiment 默认 template 可能预装昂贵工具,Eval source 可能携带题意。
Provider 没有通用原语把两份 image、template、snapshot 或 Compose 合并。

可行路径只有三类:

- 按 Eval source 构建并启动 Sandbox Case,再执行 Experiment sandbox setup。
- Eval 没有 source 时,从默认 case 启动,再执行 EvalDef setup。
- 现场组合不可行时,在 `environments[profile]` 提供预制完整 case。

第三条复用既有覆盖表,不新建融合表。

## Setup 有 owner 与顺序

SandboxSpec setup、EvalDef setup 与 Agent setup 已有不同的变化轴、归因与 teardown。
把它们压进通用 Requirement 数组会丢掉这些领域边界。

第一期按固定层次和声明顺序串行。
这是可读且可诊断的保守语义。
只有领域 helper 知道内部动作互不冲突时,才可以自行并行。

## Manifest 不是状态证明

template 名或受管 manifest 只能证明某次安装曾成功。
它不能证明二进制仍存在、PATH 与权限仍正确、动态库仍可用,也不能发现后续准备覆盖了共享目录。

昂贵或预装条件应由领域 helper 检查实际 facts,缺失时安装并复检。
plain setup function 可以始终执行,但不能声称拥有预装命中语义。

## 身份分属两层

SandboxSpec、默认 case、Experiment setup helper 与 Agent 属于 Run 级配置。
Eval Environment、所选 case 与 Eval setup helper 属于逐 Eval 身份。

函数体不自动参与哈希。
需要缓存或比较的 custom setup 必须显式声明 identity/revision,不能依赖闭包源码字符串。

## State 与 Agent runtime 正交

MemoryBench 需要外部记忆状态与复用窗口。
这些事实约束完整 Attempt 生命周期,但不改变 Environment 怎样解析成 Sandbox Case。

环境模型只为 state 与 Agent runtime 保留相位,不复制它们的公开类型。
多容器 case 的主 Sandbox、ready、证据与清理同样留在 Sandbox Feature。

## Verifier 身份先于运行

Terminal-Bench 的 hidden verifier 只能在 Agent 结束后出现，但它的内容身份必须在 Attempt 开始前进入携带决策。
API 因此需要同步、可发现的文件声明，不能只在 `test(t)` 运行期上传。

模块顶层 loader 能满足发现期身份，却把环境登记表变成作者可见副作用。
同一模块定义多条 Eval 时，它还会把不同条目的文件错误合并成整组身份。

受管 verifier 必须逐 Eval 解析，并在 Agent diff 冻结后上传。
清理是 Sandbox 复用的硬屏障；残留隐藏材料的 Sandbox 不能交给下一条 Agent。
