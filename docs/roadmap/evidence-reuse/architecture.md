# Evidence 复用政策 ——架构

`niceeval exp` 把 Experiment 声明的证据目标与历史 Evidence 对账。
它先描述每个槽位的事实状态，再由选定的复用政策决定沿用或派发。
本页定义两套候选政策共享的实体、阶段、落盘事实与跨 Run 可比性边界。

## 实体模型

```text
ExperimentDef
  → ResolvedExperiment
  → ResourceObservation[]
  → EvidenceRequirement[]
  → ReconciliationPlan
  → Evidence[] + dispatched Attempt[]
  → RunSnapshot
```

### `EvidenceRequirement`

一条 Requirement 表示「当前 Experiment 对一条 eval 的一条证据槽位有什么要求」：

```typescript
interface EvidenceRequirement {
  experimentId: string;
  evalId: string;
  slot: number;
  manifest: ExecutionManifest;
  requirementKey: string;
  proof: "proven" | "observed" | "opaque";
  opaqueReasons?: OpaqueReason[];
  policy: {
    timeoutMs?: number;
    strict: boolean;
  };
}
```

`slot` 来自 `attempts`，只表达目标数量。
`requirementKey` 是完整 manifest 的规范序列化哈希，只服务查找候选 Evidence。
它不是公开配置入口，也不替代 manifest 落盘。

### `ExecutionManifest`

manifest 保存证明一条 Evidence 是否满足当前 Requirement 所需的完整事实。
配置面、源码面与数据面三块由[既有 manifest 契约](../../feature/experiments/cache.md#manifest哈希做索引清单做解释)定稿并落进 `manifests.json`；本候选设计要加的是 `resources` 这一块，以及把环境值按角色投影进配置面：

```typescript
interface ExecutionManifest {
  version: 1;
  agent: AgentSpec;
  model?: string;
  reasoningEffort?: string;
  flags: Record<string, JsonValue>;
  strict: boolean;
  judge?: { model?: string; baseUrl?: string };
  sandbox?: ResolvedEnvironment;
  sources: SourceInput[];
  resources: ResourceIdentity[];
  sandboxReuse: boolean;
}

interface SourceInput {
  path: string;
  digest: string;
  kind: "module" | "loader";
}

interface ResourceIdentity {
  id: string;
  version: JsonValue;
  observedAt: string;
}
```

源码输入必须是完整静态闭包与 loader 依赖的路径、类型和内容 digest。
只保存最终哈希无法展示差异，也无法安全接受一次 path 变化。

`timeoutMs`、`budget`、`attempts`、`earlyExit` 与 `maxConcurrency` 不进入 manifest：它们改变资格、目标数量或编排，不改变一条已完成 Evidence 证明的被测行为。
这些值仍随 Run 落盘，供资格判断、覆盖注记与审计使用。

### `Evidence`

Evidence 是一次真实执行产生的事实，不因后来被沿用而改写身份：

```typescript
interface EvidenceOrigin {
  runId: string;
  evalId: string;
  attempt: number;
  requirementKey: string;
}

interface EvidenceRecord {
  origin: EvidenceOrigin;
  immediateCarryFrom?: { runId: string };
  authorization?: ReuseAuthorization;
}
```

`origin` 永远指向最初执行 Attempt。
连续沿用时，`immediateCarryFrom` 只记这次从哪个 Run 取来。
消费方因此能分别回答「谁真正跑的」和「这次从哪里沿用」。

## 事实状态与政策裁决

对账不是比较两个文件是否改过，而是判断历史 Evidence 与当前 Requirement 之间有哪些事实。
事实状态不随默认政策变化，action 才随政策变化。

| 事实状态 | 证明优先 | 复用优先 |
|---|---|---|
| manifest 完全相等，且其它资格门通过 | 沿用 | 沿用 |
| manifest 存在相关 delta | 派发 | 派发 |
| manifest 无法构造完整事实 | 派发 | 沿用并标 unverified |
| 原因有匹配当前计划的人工授权 | 沿用并标 authorized | 沿用并标 authorized |
| 历史槽位不存在或判定不是可信终态 | 派发 | 派发 |

两套政策的取舍见 [Policy Models](policy-models.md)。
实现不能在事实收集阶段提前把 `opaque` 折成“相同”或“不同”，否则上层无法切换或审计政策。

### 三种证明等级

- **`proven`**：输入全部来自声明式配置、内容寻址产物与完整源码 manifest。
- **`observed`**：还依赖外部资源，但规划前 observer 成功取得稳定版本。
- **`opaque`**：任意 Hook 闭包、不可解析的 mutable image、未声明的项目外依赖，或外部资源没有 observer / 静态 epoch。

`proven` 与 `observed` 都能支持精确判断；两者分开是为了说明证明来源。
`opaque` 不是错误，也不等于 changed。
证明优先默认派发，复用优先默认沿用并标 unverified。

## 对账阶段

阶段顺序固定：

1. **发现。
   **加载 Experiment 与 eval，收集静态导入闭包及 loader 依赖。
2. **解析。
   **求值 Experiment 配置、eval 选择、AgentSpec 与 Sandbox 产物引用。
3. **观测。
   **并行执行 Experiment 声明的只读 resource observer。
   observer 不创建、不修改资源，失败只使依赖项变成 `opaque`。
4. **形成要求。
   **为 `selectedEvalIds × attempts` 生成 Requirement 与完整 manifest。
5. **初始对账。
   **从历史 Evidence 中逐槽选择候选，形成事实状态并应用政策与 CLI 覆盖。
6. **取锁重判。
   **每个 Eval 取得用例锁后窄读最新 Evidence，重新形成权威决策。
7. **准备。
   **权威决策仍存在派发项时才执行有副作用的 Experiment setup。
8. **执行。
   **只派发权威决策要求执行的槽位。
9. **快照。
   **把沿用与新 Evidence 合成这次 RunSnapshot。

观测必须在初始对账之前，setup 必须在取锁重判之后。
这条边界让外部状态参与判断，避免并发 Invocation 已补齐 Evidence 后仍运行 setup 或重复派发。
人工授权携带初始计划的 `planKey`；重判后的事实不再匹配时，授权失效。

## 改完 eval 与 Experiment 后怎样判

### Eval 变化

Eval 文件、静态闭包或 loader 内容 digest 变化，使受影响 Requirement 的 manifest 不同。
两套默认政策都会重跑已观察到 source delta 的 Eval，不做注释剥离或 AST 归一化。
用户确认变化不改变题面、执行或判定时，可以接受计划列出的精确 source 原因。

### Experiment 变化

按字段语义裁决，不认整个 Experiment 文件字节：

| 变化 | Requirement | 默认结果 |
|---|---|---|
| AgentSpec、model、reasoningEffort、flags | 改变 | 受影响槽位重跑 |
| Sandbox 产物、recipe、resource version | 改变 | 受影响槽位重跑 |
| eval 选择 | 改变目标集合 | 仍选中的照常对账，新选中的补跑 |
| attempts | 改变槽位数量 | 复用已有槽位，只补缺口 |
| timeoutMs | 不改变 manifest | 再过执行耗时资格门 |
| budget、maxConcurrency、earlyExit | 不改变 manifest | 已有 Evidence 照常对账 |
| labels、description | 不改变 Requirement | 一条不动 |
| 无声明式身份的 Hook | 变成 `opaque` | 由证明优先或复用优先政策裁决 |

因此既不是「Experiment 文件改了就全跑」，也不是「解析字段没变就全用」。
默认行为来自当前要求，而不是文件粒度。

## 精确授权

授权的语义、作用域、留痕与打不开的门由 [`--accept`](../../feature/experiments/cache.md#--accept授权跨过一条精确差异)定稿：它做的是一次重锚，被携入的条目按本次口径重打指纹，跨过的差异逐条记进条目自己的 `carriedAccepting`。

资源身份接进来之后，这套授权要多担一件事：`condition:` / `sandbox:` / `resource:` 三支差异的旧值新值来自 observer 与角色摘要，不是文件内容哈希。
它们同样只覆盖当前计划里展开出的那一条差异；资源下一次变成新版本是一条新差异，照样拦下。
`opaque:` 原因授权的是“系统拿不到事实”这件事本身，风险与前几支不同类，是否要求同时写下理由仍待裁决（见 [README · 待裁决](README.md#待裁决)）。

## 外部资源

Experiment 显式声明资源 observer。
observer 返回版本，不返回连接坐标和凭据：

```typescript
interface ResourceObserver {
  id: string;
  observe(ctx: ResourceObserveContext): Promise<JsonValue>;
}
```

连接坐标与凭据只用于 observer 和真正执行，不进入 manifest、不落盘。
资源版本可以由 observer 从服务读取，也可以由 Experiment 从静态 `flags` 投影。
同一个 URL 指向新实例时，只要 observer 返回的版本不同，历史 Evidence 就失效。

observer 缺失或失败时不能声称资源没变。
对应 Requirement 变成 `opaque`，并在计划里说明原因。
证明优先默认派发；复用优先沿用并给 Evidence 与 Run 增加 unverified 标记。

## Sandbox 复用

`sandboxReuse` 改变题间状态边界，因此进入 manifest。
从 `false` 切到 `true` 或反向切换时，全部相关 Evidence 默认失效。

即使复用模式里的首个 Attempt 使用全新 Sandbox，也不单独证明它与非复用模式等价。
这项保守裁决避免把「首个看起来一样」扩展成依赖 Hook 次数与重置点的隐式规则。

## 跨 Run 可比性

Sample 拼接不读取 `requirementKey` 作唯一结论，而使用版本化读取政策：

```typescript
interface ComparisonProfile {
  version: number;
  blockingDimensions: string[];
  annotations: string[];
  ignored: string[];
}
```

- blocking 值不同：不拼接；
- annotation 值不同：允许拼接，但产生覆盖注记；
- ignored：与分析无关。

读取面从落盘 manifest 投影这些维度。
新增维度时，旧记录缺值只有两种处理：能证明缺失等价于默认值时迁移；否则为 `unknown`，不自动拼接。
读取期重算能解决算法变化，不能恢复从未落盘的事实。

## 契约验收场景

实现必须用下面七个场景证明边界，不用「哈希相等」替代行为结果：

1. **同时发生无语义与语义源码变化。
   ** 格式化 prompt 文件，同时修改断言 helper。
   只 `--accept source:...prompts.ts` 时仍不得沿用，因为 manifest 还剩一项未接受变化。
2. **Hook 源码不变、闭包值变化。
   ** Hook 捕获的 CLI 版本从 2 改成 3，但函数文本相同。
   没有 recipe 或 observer 时 Requirement 必须是 `opaque`，不得自动沿用。
3. **外部服务变化且历史槽位全满。
   ** 清空记忆库后再次运行，历史全是终态。
   observer 版本变化时必须派发；没有 observer 时必须标 `opaque`，不能因零缺口而全量沿用。
4. **身份模型新增字段。
   ** AgentSpec 增加影响行为的字段，旧 Run 没有该事实。
   ComparisonProfile 只能按已声明默认迁移，否则返回 `unknown`。
5. **mutable image 解析失败。
   ** provider 只能拿到 image 名，拿不到 immutable digest。
   环境必须标 `opaque`，不能退化为名字相等。
6. **连续沿用三轮。
   ** 第三轮必须仍能定位第一轮的 `EvidenceOrigin`，同时记录第二轮是 `immediateCarryFrom`。
   认账边不能覆盖真实执行来源。
7. **切换 Sandbox 复用模式。
   ** `sandboxReuse` 从 false 切到 true 或反向切换时，全部相关 Requirement 变化。
   即使历史 Evidence 是复用 Run 的首个 Attempt，也不得跨模式自动沿用。

## 不变量

- 事实层保留 proven、observed 与 opaque，不提前把未知折成相同或不同。
- 完整 manifest 与 `requirementKey` 一起落盘，哈希不是事实的替代品。
- Evidence 的原始执行身份永不改写；沿用只增加来源边和认账边。
- observer 只读且早于初始对账；setup 有副作用且晚于取锁重判。
- 凭据与连接坐标不进 manifest、不落盘；资源版本进 manifest。
- `--rerun` 只收紧本次采信；`--accept` 只放宽当前计划中的精确原因。
- 缓存对账与 Sample 可比性共享落盘事实，但不共享一个哈希结论。
