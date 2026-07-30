# Evidence 复用政策 —— CLI

计划矩阵、逐条作废原因、按差异聚合的分组、`--accept <selector>` 的词表与重锚语义、不带值时 TTY 下的逐原因标记，都已由 [CLI 反馈模型](../../feature/experiments/cli.md#--dry计划矩阵与作废原因)与[缓存与携带](../../feature/experiments/cache.md#--accept授权跨过一条精确差异)定稿。
本页只写资源身份与角色声明接进来之后，这套 CLI 要多出什么。

## 计划要多显示两样

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

- **policy 行。**
  同一条命令在两套默认政策下给出不同的派发集合，计划因此要点名本次按哪套判。
- **`opaque` 分组。**
  observer 失败、闭包无法投影成身份这类事实，与已观察到的 delta 分成两组：前者是“系统不知道”，后者是“系统知道变了”。

```text
reason opaque:resource.memory-corpus
  affects 4 eval · 4 evidence slots
  observer failed: 503 Service Unavailable
  default dispatch
```

## selector 要多出三支

`--rerun` 与 `--accept` 共用同一批差异名字，方向相反：前者要求重跑依赖该事实的 Eval，后者授权跨过它。
既有词表的四支（`config:` / `source:` / `data:` / `opaque:no-manifest`）之外，资源身份带来三支：

| selector | 指向 | 例子 |
|---|---|---|
| `condition:<路径>` | 声明为行为条件的环境值，manifest 里只存安全摘要 | `condition:env.AGENT_ENDPOINT` |
| `sandbox:<部分>` | Sandbox 身份的某一部分：recipe、解析后的 image ID、产物摘要 | `sandbox:recipe` |
| `resource:<id>` | observer 或静态 epoch 给出的资源版本 | `resource:memory-corpus` |

`opaque:` 相应扩成 `opaque:<依赖类别>.<id>`，例如 `opaque:resource.memory-corpus`、`opaque:sandbox.setup`。

**选择轴不进 selector。**
要只对一部分 Eval 收紧或授权，用位置参数收窄本次选择，与 [CLI 的两类输入](../../feature/experiments/cli.md)一致。
把 `eval:<前缀>` 做成 selector 等于让 flag 也能选题，同一件事两个入口；要重跑一批指定的 Eval，写法是位置参数加 `--rerun all`。

## `--dry` 要跑 observer

`--dry` 除了发现、配置解析与声明式 Sandbox 解析，还要执行 Experiment 声明的只读 resource observer，才能生成真实计划：

```bash
niceeval exp compare/codex --dry
niceeval exp compare/codex --dry --json
```

它仍不运行 Experiment setup、Sandbox create、Attempt 或 teardown，也不创建 Run。
observer 会读取凭据并访问远端服务，所以 `--dry` 不等于“完全不联网”；observer 的只读约束、超时与失败处理在 [Library](library.md)。

## 三支新差异的形态

既有的 `config:` / `source:` / `data:` 差异由 manifest 相减得出。
三支新 selector 各自要能展开成同样精确的旧值与新值：

```typescript
type NewReuseReason =
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
      dependency: "condition" | "sandbox" | "resource";
      id: string;
      diagnostic: string;
    };
```

condition 与 Sandbox 的 digest 来自规范序列化后的对应 manifest 子树，不暴露原始敏感值。
secret 不形成差异，也不出现在任何 selector 里。

## 机器计划要多两个字段

`--dry --json` 的每条决策在既有字段之外补上证明等级与本次政策：

```typescript
interface EvidencePlanDecision {
  experimentId: string;
  evalId: string;
  attempt: number;
  action: "reuse" | "dispatch";
  /** 事实层的证明等级，不是政策裁决后的结论。 */
  confidence: "proven" | "observed" | "opaque" | "authorized";
  reasons: NewReuseReason[];
  acceptedSelectors: string[];
  locked?: boolean;
}
```

顶层同时保存 `policy` 与 observer diagnostics。
事件流接入方式与既有 `--json` 词表一起裁决。

## 两套默认政策下的同一组 flag

| 动作 | 证明优先 | 复用优先 |
|---|---|---|
| 不带 flag | `opaque` 派发 | `opaque` 沿用并标 unverified |
| `--rerun ...` | 在严格默认上继续收紧 | 为未知世界提供主要复验出口 |
| `--accept ...` | 为精确例外放宽 | 主要用于已观察到的 delta |

flag 的方向在两套政策下保持一致，切换默认不会让同一个 flag 反转含义。
