# 缓存与携带：哪些 Attempt 可以继续使用

Experiment 缓存不复制结果。Runner 从当前 Record 找到一个已有 Attempt，并在新 Run 的 slot 中建立 carried 或 accepted Member。

Attempt 的执行事实只保存一次。Member 说明本 Run 为什么采用它；后续读取始终取得源 Attempt 的当前业务值。

## 自动携带资格

一条 Attempt 必须同时通过以下条件，才能自动 carry：

| 条件 | 判断对象 | 不通过时 |
|---|---|---|
| 终态 | Verdict 是 `passed` 或 `failed` | 派发执行 |
| fingerprint | 执行输入与当前输入相同 | 派发执行 |
| timeout | `executionMs` 不超过当前 `timeoutMs` | 派发执行 |
| `--rerun` | 本次档位允许采用该 Verdict | 派发执行 |
| `--keep-sandbox` | 本次没有要求保留新现场 | 派发执行 |

不存在、无法读取、`errored` 或 `skipped` 的 Attempt 都不能自动 carry。Verdict 与 eligibility 任一不是 read + durable complete + decoding complete，或 payload 不符合精确形状，也必须执行。重复 `attemptId`、dangling Member 或结构错误先由 Record reader 隔离，不能作为候选。

上述列表是本格式自动 carry 的穷尽输入。<code>--rerun</code> 与 <code>--keep-sandbox</code> 是本次 policy；指定 <code>--keep-sandbox</code> 时自动 carry 全部关闭。新配方输入必须通过更换 input/config identity domain 纳入。无法归约到既有 identity、duration 或本次 policy 的新持久 gate 不能新增 planner-critical channel；产品若必须使用它，就更换完整格式名。

规划只支持停稳 Record。同一 root 已有 active reader、writer 或人工编辑时，Runner 以 <code>record-root-busy</code> 失败；它不等待运行中结果，也不重新读取变化中的目录。静态 export 只有 Record 读取/build 阶段占用 reader lease。

## 规划身份不是 Record 版本

```text
configIdentity = { domain, value }
inputIdentity  = { domain, value }
```

这两个值都是不透明的相等性 token，只用于规划阶段快速比较输入，不承担 Record 身份、防伪或编辑检测。只有 `domain` 相同的 token 才能比较；算法、输入闭包或配方的语义改变时，生产方必须换一个新的 `domain`，旧值因此自然不匹配。旧 planner 也只会生成旧 domain，因此不会误用新 Attempt。`attemptId` 与 locator 都不从这些 token 派生。

同一次计算还生成可读 manifest。它列出已求值配置、源码闭包和受管数据文件，让 CLI 能说明哪个输入不同。identity、manifest 与资格判断写入 Attempt 或 Run 的具名通道，不进入永久核心结构。

直接 callback 没有稳定输入描述。需要它参与自动作废时，作者使用 `defineSandboxCommand()` 并维护其声明的 `revision` 与 `inputs`；这里的 `revision` 只是作者给命令配方的业务字段，不是 Record 版本。

凭据不进入 fingerprint 或 manifest。`judge.apiKeyEnv` 只表示读取凭据的位置；Judge model、baseUrl 与 timeout 属于已求值配置。

## timeout 资格

`timeoutMs` 不进入 input identity，因为它不改变已经发生的执行事实。carry 另行要求执行时长不超过当前 `timeoutMs`；未设置 timeout 视为无上限。

提高上限不会让 Attempt 失去资格。降低上限后，超过限制的 Attempt 必须重新执行。

执行时长保存为 `{ domain, milliseconds }`。`milliseconds` 是单调时钟区间向上取整得到的非负 safe integer；只有相同 `domain` 的值才允许比较。它来自 Attempt 的 eligibility 通道，不从目录时间推断。

## 以 slot 为粒度携带

`attempts: 5` 已有三个合格 Attempt 时，新 Run 只补两个缺失 ordinal。调大 attempts 只增加 expected slot，调小则让新 Run 使用较小分母，不删除已有 Run 或 Attempt。

每个自动采用的 slot 只写永久核心引用：

```ts
interface CarriedMember {
  readonly kind: "carried";
  readonly runId: string;
  readonly slotId: string;
  readonly attemptId: string;
}
```

建立 Member 时的 input/config identity、资格与理由写入该 Run 的 `niceeval.actions` 通道，并以 `slotId`、`attemptId` 关联。它不冻结 Attempt，也不在用户编辑 Attempt 后把 Member 标成失效。未来需要新增 action 字段时，只演进这个通道，不改 Member 核心。

locator 是完整 128-bit `attemptId` 的可逆表示。carry 不生成新的 Attempt identity 或 locator。

## `niceeval accept`

fingerprint 不同时，操作者可以明确接受一个或多个已有 Attempt：

```sh
niceeval accept @01J8ZK3M6P4T7V9X2C5N8QW0RY
niceeval accept @01J8ZK3M6P4T7V9X2C5N8QW0RY @123456789ABCDEFGHJKMNPQRST
```

locator 列表是唯一授权范围。命令不接受动态 query、差异类别或批量表达式。

### 预检与写入

`accept` 在写入前对全部 locator 完成预检：

1. locator 语法合法且能查到唯一 `attemptId`；
2. Attempt 可读并已有终态；
3. 当前 Experiment 与 Eval 可以发现；
4. 当前配置、timeout 和 Sandbox pair 可以求值；
5. 同一 Run 中没有重复 slot 或重复授权。

任一检查失败时零写入。全部通过后，命令按 Experiment 建立新 Run，并为每个显式成员写 accepted Member：

```ts
interface AcceptedMember {
  readonly kind: "accepted";
  readonly runId: string;
  readonly slotId: string;
  readonly attemptId: string;
}
```

accepted Member 不复制 Attempt 数据。操作者接受的 identity、差异与理由写入该 Run 的 `niceeval.actions` 通道；这些值只解释当时接受了什么，不持续认证源值。

### 输出与错误

成功输出原 locator、Experiment、Run、slot 与 `accepted`。Invocation receipt 只返回本次 `runIds` 和进程完成状态。

| 错误 | 含义 | 下一步 |
|---|---|---|
| `malformed-locator` | locator 语法不合法 | 复制完整 locator |
| `locator-not-found` | Record 没有对应 Attempt | 打开正确 Record 或检查输入 |
| `accept-ineligible` | Attempt、timeout、发现或计划不满足条件 | 阅读差异后重跑或修正配置 |
| `duplicate-accept-member` | 同一目标 slot 重复授权 | 每个 slot 只给一个 locator |

## origin Run 可以 unfinished

Attempt 目录已经完整发布、Verdict 已终结且引用有效时，可以成为 carry 或 accept 候选。origin Run 没有 `completedAt` 不会删除这份 Attempt。

这条规则不承诺恢复 Agent 已经修改的外部系统、共享数据库或 checkpoint。作者仍需为外部状态提供可恢复边界。

## 并发 Invocation

同一 Record root 只允许一条 Invocation。另一个进程指向它时立即得到 <code>record-root-busy</code>，不能协作领取 Eval 或读取对方运行中的 Attempt。

需要并行两条 Invocation 时必须指定不同 Record root。它们各自规划、写入和形成 Sample，不自动合并；完成后也不能把两个 Record 暗中拼成一个分母。

## `--rerun`

| 写法 | 可自动采用 | 本次执行 |
|---|---|---|
| 不带 | `passed` 与 `failed` | `errored`、`skipped` 与缺失 ordinal |
| `--rerun` / `--rerun failed` | `passed` | 上述成员与所有 `failed` |
| `--rerun all` | 无 | 选中矩阵中的全部成员 |

`--rerun` 只作用于本次 Invocation，不改 fingerprint，也不修改已有 Run。

## 相关阅读

- [Architecture](architecture.md#carry) —— carried Member 的实体关系。
- [实验改名](rename.md) —— 通过 accepted Member 表达 Experiment 改名。
- [Record Architecture](../record/architecture.md) —— Run、Member 与 Attempt 不变量。
- [Record CLI](../record/cli.md) —— locator 语法与错误。
