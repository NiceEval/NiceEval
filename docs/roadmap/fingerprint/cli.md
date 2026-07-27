# Experiment 对账 —— CLI 预期反馈

CLI 先把当前证据目标与历史 Evidence 对账，再执行计划。
默认命令不要求用户决定「用不用缓存」：

```bash
niceeval exp compare/codex
```

系统按证明结果自动沿用或派发。
用户只在两个方向上覆盖默认计划：`--rerun` 收紧采信，`--accept-change` 放宽一份精确源码差异。

## 默认计划

执行前的人读反馈先给出可解释的总数：

```text
compare/codex
  36 eval · 108 个证据槽位
  92 个沿用：当前要求未变
  10 个失效：eval 或实验条件变化
   4 个不透明：memory-corpus 无法观测版本
   2 个缺失
  将派发 16 个 attempt
```

`--dry` 只生成这份计划，不运行 setup、Sandbox 或 Attempt：

```bash
niceeval exp compare/codex --dry
```

详细模式按 eval 列出原因与 manifest delta：

```text
memory/recall-03
  source changed
    evals/share/prompts.ts  80d1… → b91a…
  decision  dispatch

memory/recall-04
  resource opaque
    memory-corpus  observer failed: 503 Service Unavailable
  decision  dispatch
```

输出不使用「cache hit / miss」作为主词。
用户关心的是证据为什么仍有效或为什么要派发，不是内部索引是否命中。

## 默认沿用边界

不带覆盖 flag 时：

- Requirement 完全相等且资格门通过：沿用；
- 已知只影响编排的字段变化：沿用已有部分；
- 被测条件、eval 输入或判定变化：派发；
- 依赖为 `opaque`：派发；
- 已有 attestation 覆盖当前精确 source delta：沿用。

未知按派发处理，不弹交互确认。
CI 与本地命令因此使用同一条确定性默认路径。

## `--rerun`：收紧本次采信

现有三档语义保留，但从「重跑缓存」改写成「本次对账采信哪些判定」：

| 写法 | 本次仍采信 | 额外派发 |
|---|---|---|
| 不带 | 满足当前 Requirement 的 passed 与 failed | 缺失、失效、opaque、errored、skipped |
| `--rerun failed` | 只有 passed | 上面那些，加 failed |
| `--rerun all` | 都不采信 | 当前目标里的全部槽位 |

它用于两类场景：

- Experiment 没有 observer，但用户知道外部世界变了；
- 用户需要复验，即使当前 Requirement 没有变化。

`--rerun` 只影响这次 Invocation，不写永久规则。

## `--accept-change`：接受一次精确源码变化

格式化了共享文件，但题面、执行与判定语义没有变化：

```bash
niceeval exp compare/codex --accept-change evals/share/prompts.ts
```

这个 flag 不按路径忽略内容。
它只能接受当前计划中已经存在的 old digest → new digest 转换：

```text
accept-change  evals/share/prompts.ts
  80d1… → b91a…
  30 个 Evidence 经这次转换认账
  其它 manifest 输入完全相等
```

落盘的是精确 `ReuseAttestation`：

```typescript
interface ReuseAttestation {
  fromRequirementKey: string;
  toRequirementKey: string;
  acceptedSources: Array<{
    path: string;
    fromDigest: string;
    toDigest: string;
  }>;
  createdAt: string;
}
```

### 约束

| 约束 | 不满足时 |
|---|---|
| 路径必须出现在当前计划的 source delta | 用法错误，列出可接受的路径 |
| 除接受项外的 manifest 必须完全相等 | 不放行，并列出其它变化 |
| from 与 to digest 必须不同 | 用法错误，指出这是空转 |
| 只接受项目根内的 module / loader 输入 | 用法错误 |
| `--rerun all` 下不得同时认账 | 用法错误；本次没有任何历史 Evidence 会被采信 |

路径可重复给。
文件重命名或拆分用 old path 与 new path 一起接受，计划显示 delete + add。

### 一次认账，后续照常

认账建立 `fromRequirementKey → toRequirementKey` 的证据等价边。
原 Evidence 的 requirementKey 与真实执行来源不改写。

下一轮 Requirement 仍是同一个 to key 时，可以沿用这条已经记录的关系；
文件再次变化产生第三个 digest 时，旧认账不匹配，必须重新判断。
因此它是一次状态转换认账，不是永久 source ignore。

## 两个覆盖方向

| flag | 默认计划怎样变化 | 错误方向 |
|---|---|---|
| `--rerun` | 少采信、多派发 | 多花一次成本 |
| `--accept-change` | 多采信、少派发 | 可能采信语义已变化的旧证据 |

因此 `--rerun` 可以按判定档位批量作用；
`--accept-change` 只能针对计划里可枚举、可审计的精确 source delta。
Agent、Sandbox 与外部资源变化暂不开放同类认账出口。
