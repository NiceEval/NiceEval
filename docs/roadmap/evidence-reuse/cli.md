# Evidence 复用政策 —— CLI

CLI 先生成当前 Requirement 与历史 Evidence 的对账计划，再执行仍需派发的部分。
默认命令不要求用户回答“用不用缓存”：

```bash
niceeval exp compare/codex
```

计划必须同时服务人和机器。
人读面解释原因；`--dry --json` 输出同一组结构化决策，不能把权威 delta 只写进文本。

## 默认计划

```text
compare/codex
  policy  proof-first
  36 eval · 108 evidence slots
  92 reuse · proven unchanged
  10 dispatch · observed changes
   4 dispatch · opaque resource
   2 dispatch · missing
  16 attempts to run
```

详细计划按 Evidence 槽位聚合相同原因：

```text
reason source:evals/share/prompts.ts
  affects 30 eval · 30 evidence slots
  change modify 80d1… → b91a…
  default dispatch

reason opaque:resource.memory-corpus
  affects 4 eval · 4 evidence slots
  observer failed: 503 Service Unavailable
  default dispatch
```

每个 reason selector 在当前计划内唯一且稳定。
它既是解释锚点，也是人工覆盖的最小授权单位。

## `--dry`

`--dry` 执行发现、配置解析、声明式 Sandbox 解析与只读 resource observer，以生成真实计划：

```bash
niceeval exp compare/codex --dry
niceeval exp compare/codex --dry --json
```

它不运行 Experiment setup、Sandbox create、Attempt 或 teardown，也不创建 Run。
因为 observer 可能读取 secret 并访问远端服务，`--dry` 不是“完全不联网”的同义词。
observer 的只读约束、超时与错误仍按 [Library](library.md) 执行。

## 收紧：`--rerun`

`--rerun` 让本次少采信、多派发，可重复：

| selector | 作用 |
|---|---|
| `failed` | 不采信历史 failed，passed 仍可沿用 |
| `all` | 当前目标里的全部槽位都真实执行 |
| `eval:<prefix>` | 重跑匹配的 Eval |
| `resource:<id>` | 重跑依赖该资源的 Eval |
| `source:<path>` | 重跑依赖该源码或 loader 输入的 Eval |
| `condition:<path>` | 重跑依赖该 manifest 条件的 Eval |
| `sandbox:<part>` | 重跑依赖该 Sandbox 身份部分的 Eval |

示例：

```bash
niceeval exp compare/codex \
  --rerun resource:memory-corpus \
  --rerun eval:memory/high-risk
```

selector 取并集。
`all` 与其它 selector 同时出现是用法错误，因为其它项已没有额外含义。
`--rerun` 只作用于当前 Invocation，不写永久失效规则。

## 放宽：`--accept`

`--accept` 让本次多采信、少派发，可重复。
参数必须匹配当前计划列出的 reason：

```bash
niceeval exp compare/codex \
  --accept source:evals/share/prompts.ts
```

系统记录的不是字符串 selector，而是它在当前计划中展开出的精确事实：

```typescript
interface ReuseAuthorization {
  planKey: string;
  fromRequirementKey: string;
  toRequirementKey: string;
  reason: ReuseReason;
  affected: Array<{ experimentId: string; evalId: string; slot: number }>;
  createdAt: string;
  note?: string;
}

type SourceDelta =
  | { kind: "modify"; path: string; fromDigest: string; toDigest: string }
  | { kind: "delete"; path: string; fromDigest: string }
  | { kind: "add"; path: string; toDigest: string };

type ReuseReason =
  | { kind: "source"; selector: string; deltas: SourceDelta[] }
  | {
      kind: "condition";
      selector: string;
      path: string;
      fromDigest: string;
      toDigest: string;
    }
  | {
      kind: "sandbox";
      selector: string;
      part: string;
      fromDigest: string;
      toDigest: string;
    }
  | {
      kind: "resource";
      selector: string;
      resourceId: string;
      fromVersion: JsonValue;
      toVersion: JsonValue;
    }
  | {
      kind: "opaque";
      selector: string;
      dependency: "source" | "condition" | "sandbox" | "resource";
      id: string;
      diagnostic: string;
    };
```

condition 和 Sandbox 的 digest 来自规范序列化后的对应 manifest 子树，不暴露原始敏感值。
secret 不形成 delta，也不进入 `ReuseReason`。

### 可以接受什么

| 原因 | 示例 | 风险 |
|---|---|---|
| source delta | 注释、格式或确认无语义的重构 | 可能误认真实题面或判定变化 |
| condition delta | 已确认两个配置值对这些 Eval 等价 | 可能混合不同被测条件 |
| Sandbox delta | 镜像重打包但内容语义等价 | 可能采信不同工具链产物 |
| resource delta | 服务迁移但数据与行为等价 | 可能采信另一资源的结果 |
| opaque reason | observer 故障但操作者确认资源未变 | 系统没有独立证据验证判断 |

框架不按类别禁止用户授权。
权限边界来自精确计划、显式 selector、Eval 作用域和落盘审计，而不是一张硬编码白名单。

### 不可以接受什么

- 缺失 Evidence；
- `errored`、`skipped` 或资格门不通过的 Evidence；
- 当前计划里不存在的 selector；
- secret 的旧值或新值；
- 一个面向未来变化的路径 glob；
- 与 `--rerun all` 同时使用。

## 只对部分 Eval 授权

位置参数先收窄当前计划，`--accept` 和 `--rerun` 再作用于该计划：

```bash
niceeval exp compare/codex memory/recall \
  --accept source:evals/share/prompts.ts
```

只有选中的 `memory/recall*` Evidence 获得授权。
其它 Eval 之后运行时仍会看到未授权 delta，并按默认政策处理。

如果一次命令需要同一 source 对部分 Eval 接受、对另一部分重跑，必须拆成两个 Invocation。
候选设计暂不引入复杂的 `selector@eval-selector` 内联语法。

## 并发 Invocation

启动时的计划是解释与预测，不是派发权威。
每个 Eval 取得用例锁后必须重做一次窄范围对账，再决定是否执行。

- 新 Evidence 已由其它 Invocation 补齐时，本次改为沿用。
- 当前 delta 与授权的 `planKey` 不再匹配时，授权失效并重新按默认政策判断。
- Experiment setup 只在获锁后的权威计划仍有派发项时运行。
- 运行反馈必须显示 `dispatch → reuse` 等计划变化；`--dry` 只显示启动时快照。

## 机器计划

`--dry --json` 的每个决策至少包含：

```typescript
interface EvidencePlanDecision {
  experimentId: string;
  evalId: string;
  slot: number;
  action: "reuse" | "dispatch";
  confidence: "proven" | "observed" | "opaque" | "authorized";
  reasons: ReuseReason[];
  authorizationSelectors: string[];
  locked?: boolean;
}
```

顶层同时保存 `policy`、`planKey`、聚合计数和 observer diagnostics。
具体 schemaVersion 与事件流接入方式留待 CLI 总契约一起裁决。

## 两套默认政策下的同一组 flag

| 动作 | 证明优先 | 复用优先 |
|---|---|---|
| 不带 flag | opaque 派发 | opaque 沿用并标 unverified |
| `--rerun ...` | 在严格默认上继续收紧 | 为未知世界提供主要复验出口 |
| `--accept ...` | 为精确例外放宽 | 主要用于已观察到的 delta |

flag 的方向保持一致，避免切换默认政策后同一个 flag 反转含义。
