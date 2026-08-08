# 方案 2：Lifecycle

**相关文档**：[README](README.md) · [Architecture](architecture.md) · [Use Cases](use-case/README.md) · [CASES](../CASES.md)

本篇只定义 Behavior 从声明、静态聚合、证据准备到单例复跑的跨 owner 时序。
类型、媒介边界和不变量以 [Architecture](architecture.md) 为准。

## Owner

| Owner | 拥有 | 不拥有 |
|---|---|---|
| Feature 文档 | 用户任务与产品结果契约 | 测试实现、fixture |
| Behavior owner | Behavior ID、任务/契约引用、PrimaryProof | 外仓执行器 |
| Proof owner | 本仓 proof、User View、parser、recipe | 其它仓的预期 |
| 根 Registry | 当前 checkout 的只读静态聚合 | E2E 运行时、secret、evidence |
| `scripts/e2e.ts` | 本仓 prepare、freeze、verify 参数与退出码 | 中央测试语义 |
| media adapter | 从 evidence 提取 `Observed<T>` | 产品算法与期望 |
| identity-aware matcher | 比较测试侧期望并登记 outcome | 生成候选结果 |

根仓 repository ID 固定为 `niceeval`。
自治 E2E 仓库使用自己的 `e2e.json.id`。

## 声明与静态聚合

```text
tracked test source
  → 本仓 AST guard 读取字面量 Behavior / Proof / MutationAction 元数据
  → 校验 ID、task、contract、本仓引用与 action module / export
  → 形成内存 BehaviorManifest
  → 根 guard 只读扫描当前 checkout 的所有仓库
  → 解析跨仓引用与 required BoundaryProof
  → 输出不签入的行为索引
```

Manifest 不运行测试、不读取 candidate、不需要 secret，也不签入。
根 `test/docs/behavior-registry.test.ts` 直接扫描根仓与 `e2e/` 的 tracked source；它不安装 E2E 依赖，也不调用自治仓库生成器。

独立 E2E checkout 只定位本仓拥有的 task / contract。
外部 `ContractRef` 只检查 `repository + path + anchor` 形状。
完整 checkout 的根 guard 按 repository root map 定位外部 heading。

每个 `scripts/e2e.ts` 在 prepare 前完成本仓静态检查，并把 `behavior-manifest.json` 写进**本次运行 artifact 目录**供独立 CI 阅读。
它不是签名、锁文件或下次运行输入。

## Unit Behavior

```text
Vitest 收集 Behavior
  → 创建本例 fixture
  → User View 从公开 Library 入口执行用户动作
  → media adapter 产生 Observed<T>
  → matcher 比较测试侧期望
  → 生成 OutcomeAssertion
  → 销毁 fixture
```

每例重新创建可变 fixture。
User View 不推进时钟、不控制 barrier，也不读取私有结果补足期望。
Effect supporting proof 继续走原生 `it.effect` / `it.scoped`；Proof 关联只给标题附加静态 ID。

## E2E Fresh

Behavior 同文件可以用局部 `defineEvidenceRecipe()` 就地写出公开 argv、项目文件修改和 capture 名称。
Recipe 没有期望或 matcher；它的 AST、引用字面量、prepare symbol closure 和声明 fixture roots 分别进入独立 fingerprint。

```text
scripts/e2e.ts
  → 定位并摘要候选 tarball
  → 在仓库外 cwd 安装候选
  → 执行全部 recipe 与真实副作用
  → 生成 text / protocol event / JSON / XML / HTML / PTY / trace
  → 关闭子进程和文件句柄
  → 拒绝绝对路径、..、越根 symlink 与未登记 artifact
  → 写 artifact digest 与 manifest
  → 计算不含 manifest 自身的 path / type / content 文件树 digest
  → 在临时目录移除写权限
  → 原子 rename 为 frozen world
  → Vitest 逐 proof 只读 verify
  → 每例前后复核文件树 digest
```

为后续只读观察生产输入证据的安装、实验、SDK、报告、迁移和 package-consumer 命令都在 prepare。
Verify 不重新执行可能写缓存、自动迁移或改变结果的候选命令。

浏览器 proof 在 verify 为每例创建全新 Playwright Chromium BrowserContext / Page。
静态 HTML proof 禁用 JavaScript 并阻断非本地网络；交互 proof 才启用 JavaScript，过滤和展开只修改该页状态。
静态 server、browser profile、ARIA snapshot、截图、日志与 trace 全部写进 world 外的 Verification Run。
World 保存 producer identity；每个 browser `ObservationSource` 登记 run ID、verifier identity、run artifact 与 frozen HTML 出处。

## 冻结与 mutation

冻结同时靠四层保证：

1. 根内路径与 symlink 守卫；
2. 递归只读权限，平台支持时再用只读 mount；
3. guarded evidence reader；
4. 每个 proof 前后的文件树 digest。

任一写入都报告新增、删除或变化路径。
权限不是唯一防线。

迁移、修复等写动作本身就是待测行为时，proof 声明 `mode: "mutable-clone"`。
Prepare 只冻结动作前 baseline；verify 创建单例私有 `MutableScenarioClone`，核对 `cloneId / ownerProofId / baseWorldDigest`，再执行声明的 `mutationActionId`。
Clone 有独立身份、初始/最终 tree digest、临时根与完整资源释放；不能跨例共享，也不能改变原 world。
Reuse 只省掉 baseline prepare，不省略这次待测 mutation。

`mutationActionId` 必须定位为本仓唯一的 `defineMutationAction()` export。
静态守卫核对 action 的公开入口与 proof target；运行时在创建 clone 前导入该 export，复核 ID 与入口，并摘要它的完整静态 symbol closure。
Action fingerprint 进入 `VerificationIdentity`，action ID 与 clone ID 进入 `VerificationRun`。
实现变化只改变本次 verifier 身份；fresh 与 reuse 都必须在新的私有 clone 上执行当前 action 一次。

## E2E Reuse

唯一单例复跑入口是：

```bash
pnpm e2e -- verify \
  --world <world-manifest> [--world <another-manifest> ...] \
  --behavior <behavior-id>
```

本仓 `scripts/e2e.ts` 是唯一读取参数的入口。
它先定位当前注入 candidate，再校验：

- 每个选中 E2E proof 的 `evidenceRecipeId` 恰好匹配一个 world；
- candidate、recipe、producer symbol closure 与 fixture digest；
- 外部依赖与适用 producer environment identity；
- `state === "frozen"`、文件树 digest 与全部 artifact；
- prepare evidence 均位于匹配 world root；verify 新生成文件只写入匹配 Verification Run root。

任一项不匹配都以 expired-evidence 失败，列出差异并提示重新执行完整 `pnpm e2e`。
Reuse 绝不静默 prepare、调用模型或改写 manifest。

## Fresh / Reuse 次数

| 动作 | fresh run | reuse 同一 Behavior | 每个 proof |
|---|---:|---:|---:|
| 定位并摘要当前 candidate | 1 | 1 | 0 |
| 安装候选 | 每个 world 1 | 0 | 0 |
| 模型 / SDK / CLI 副作用 | 每个 world 1 | 0 | 0 |
| 冻结与文件树 digest | 每个 world 1 | 校验 1 | 前后各 1 |
| BrowserContext / Page | 0 或每个 browser proof 1 | 每个 browser proof 1 | 最多 1 |
| OutcomeAssertion | 每个执行 proof 至少 1 | 选中 proof 至少 1 | 至少 1 |
| mutable clone + 待测 mutation | 仅 mutation proof 1 | 仅 mutation proof 1 | 不共享、每次都执行 |

## 运行完整性

静态 Registry 只能证明声明关系。
PrimaryProof 与每个 required BoundaryProof 执行后都必须各自产生 `ProofRunResult`：

- target 与声明的 entry、observations、boundaries 完全相符；
- 每个 observation 至少贡献一个带 evidence 与 selector 的出处；
- 关系断言在同一个 outcome 中登记全部参与出处；
- 至少一个 outcome 按用户对象身份验证结果。
- E2E proof 的 execution、实际 world recipe 与可选 mutable clone 完全相符。

因此，CLI exit-code smoke 不能满足“安装后的 CLI 只派发变化 attempt”。
它必须从该次 CLI evidence 中观察被执行的 attempt 身份。

## Cases

| Case | 生命周期落点 |
|---|---|
| C1 | unit 主证明每例 fresh；CLI required boundary 有自己的 prepared world 与 outcome |
| C2–C3 | 一份 Report world，多种只读 observation；browser 每例 fresh context |
| C4 | 原生 Effect unit 生命周期，不进入 E2E world |
| C5 | fresh prepare 一次，严格 identity reuse，多 proof 只读 |
| C6 | prepare 同次捕获真实上游 event 与公开 JSON，verify 逐字段比较 |
| C7 | 安装、运行、读回全在 package-consumer recipe，verify 不再执行命令 |
| C8 | 用户回归进入 Behavior；纯机制回归保持原生测试 |
