# 用 show 诊断两个 Harness 端到端场景

Harness 评估 NiceEval 的真实使用旅途，而不是逐个给内部 API 形状打分。
它收敛为两个端到端场景，并要求 Agent 只通过 `niceeval show` 诊断运行结果。

禁止直接 `cat`、`jq`、`rg` 或用其它工具读取 `.niceeval` 原始文件。
这是一项可观察工具输入约束，不宣称 NiceEval 能审计 OS syscall。

## 场景一：修复基建后处理结果

Fixture 缺少 Python，第一次运行因此 errored。
Agent 应先执行非 dry-run 的 `niceeval exp local`，再用 `niceeval show` 定位最早失败阶段。
修复基建后，Agent 重新运行受影响场景，并根据公开结果判断是否执行 `niceeval accept`。

机器 Assertion 负责：

- 真实运行过 experiment；
- 所有诊断经过 `show`；
- `exp → show → assistant reply` 顺序互不重叠；
- 没有通过工具输入直接引用 `.niceeval`；
- 指定 Turn 没有改业务文件，修复 Turn 改了目标基建文件；
- 若执行 accept，其 command occurrence 已成功结束。

Judge 只检查回复是否正确解释 errored、修复后的结果与 accept 决策，不重新判断命令和文件事实。

## 场景二：区分模型能力与断言问题

第二个 Fixture 是没有历史结果的新 repo。
Agent 运行 experiment 后，只能根据 `niceeval show` 判断失败来自模型能力不足，还是 Eval 的确定性 Assertion 过紧。

机器 Assertion 继续证明运行、show、回复顺序和禁止读取原始文件。
Judge 只评价归因是否结合 show 提供的 Assertion 详情与实际候选行为，不能接受没有公开结果依据的猜测。

## 推荐调用

每条检查都在调用点保持一行，不预声明 matcher、RegExp 或共享规则构造器：

```ts
turn1.eventOrder([{ command: { pattern: /\bniceeval(?:@\S+)?\s+(?:--\s+)?exp\s+local\b/i, excludes: { pattern: /--dry(?:-run)?\b/i } } }, { command: { pattern: /\bniceeval(?:@\S+)?\s+(?:--\s+)?show\b/i, status: "completed" } }, { reply: "assistant" }]).gate();
turn1.toolInputsExclude({ pattern: /\.niceeval(?:[/\\]|\b)/ }).gate();
turn1.changes.noChanges().gate();
turn2.changes.fileChanged("infra/python.toml").gate();
turn2.ranCommand({ pattern: /\bniceeval(?:@\S+)?\s+(?:--\s+)?accept\s+@\S+/i, status: "completed" }).gate();
const newEvalPath = await t.requireOne(turn2.changes.files({ kind: "added", path: { pattern: /\.eval\.ts$/ } }), { label: "恰好新增一条可发现的 eval", points: 2 });
t.check(t.sandbox.file(newEvalPath), { contains: "defineEval", excludes: { contains: "match.where" } }).points(2).gate();
t.check(t.sandbox.json("config/policy.json"), { shape: { id: { type: "string" }, scorers: { array: { exact: ["nonEmpty"] } } } }).points(3).gate();
```

第一条 sequence 已经证明 `exp` 与 `show` 存在，不再重复登记两条 `ranCommand()`。
`accept` 不属于该 sequence，且它的成功状态是独立结果，所以单独登记。

`requireOne()` 成功后返回 source 元素类型。
若 `changes.files()` 返回 `EvidenceSource<readonly SandboxPath[]>`，`newEvalPath` 就是 `SandboxPath`，不是 `string | undefined`。

## 诊断闭环

两个场景都遵守同一闭环：

1. 执行最小 experiment slice；
2. 使用 `niceeval show` 查看 Attempt、阶段、Assertion 与 Verdict；
3. 根据公开输出修复基建、候选实现或 Eval 规则；
4. 只重跑受影响场景；
5. 再次使用 `show` 复核；
6. 在 assistant reply 中交代证据与判断。

CLI 无法显示所需诊断时，Harness 应把它登记为 NiceEval 呈现缺口。
它不能绕过 CLI 去读私有文件，再把私有格式变成 Eval 契约。

## History JSON

Harness 可以让 Agent 通过公开 `niceeval show --history --json` 把 stdout 写进 Sandbox 临时文件。
Eval 随后用一条 `t.check()` 检查完整 JSON，不自行 parse，也不为 history 新增业务 matcher。

下面的 shape 假定公开输出用 `sections`、`attempts` 与 `deltas` 表达四个 case。
字段名应跟随最终 CLI JSON schema；array relation 与 field presence 语义保持不变。

```ts
t.check(t.sandbox.json("/tmp/niceeval-history.json"), {
  shape: {
    sections: {
      array: {
        unordered: [
          {
            shape: {
              case: "alpha",
              attempts: { array: { exact: [{ shape: { verdict: "passed", acceptedFrom: { present: true } } }] } },
              deltas: { array: { exact: [{ shape: { selector: { shape: { kind: "sandbox", image: { type: "string" } } }, from: { contains: "runtime:node" }, to: { contains: "runtime:python" }, agent: { absent: true }, model: { absent: true }, eval: { absent: true }, flags: { absent: true } } }] } },
            },
          },
          {
            shape: {
              case: "beta",
              attempts: { array: { exact: [{ shape: { verdict: "passed", acceptedFrom: { present: true } } }] } },
              deltas: { array: { exact: [{ shape: { selector: { shape: { kind: "sandbox", image: { type: "string" } } }, from: { contains: "runtime:node" }, to: { contains: "runtime:python" }, agent: { absent: true }, model: { absent: true }, eval: { absent: true }, flags: { absent: true } } }] } },
            },
          },
          {
            shape: {
              case: "gamma",
              attempts: { array: { exact: [{ shape: { verdict: "failed", acceptedFrom: { present: true } } }] } },
              deltas: { array: { exact: [{ shape: { selector: { shape: { kind: "sandbox", image: { type: "string" } } }, from: { contains: "runtime:node" }, to: { contains: "runtime:python" }, agent: { absent: true }, model: { absent: true }, eval: { absent: true }, flags: { absent: true } } }] } },
            },
          },
          {
            shape: {
              case: "case-d",
              attempts: { array: { exact: [{ shape: { verdict: "errored", acceptedFrom: { absent: true } } }, { shape: { verdict: "passed", acceptedFrom: { absent: true } } }] } },
              deltas: { array: { exact: [] } },
            },
          },
        ],
      },
    },
  },
}).points(8).gate();
```

`unordered` 对四个 section 做 exact multiset 匹配，所以不依赖 CLI 展示顺序，也不允许第五个 section。
前三个 section 各有一条 delta，case-d 没有 delta，因此同一条 Assertion 也证明 delta 总数恰好为 3。

每个 delta 的 `agent`、`model`、`eval` 与 `flags` 都要求 absent。
它们不会因为 outer shape 默认允许其它字段而漏掉禁止的差异种类。

current JSON 的汇总可以保持一条短 Assertion：

```ts
t.check(t.sandbox.json("/tmp/niceeval-current.json"), { shape: { summary: { shape: { passed: 3, failed: 1, errored: 0 } } } }).points(2).gate();
```

JSON syntax error、非法 UTF-8 与 missing 都是 Assertion failed。
permission、transport、timeout 与 terminated 是 unavailable；parser 或 provider defect 才使 Attempt errored。
