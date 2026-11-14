# Run CLI

Run 生命周期命令为：

```sh
niceeval run list [--state <state>]... [--experiment <id-prefix>] [--limit <n>] [--invocation <invocation-id>] [--record <file>] [--json]
niceeval show run:<run-id> [--record <file>] [--json]
niceeval run delete <run-id> [--yes] [--json]
niceeval run recover <run-id> [--yes] [--json]
niceeval run recover --orphaned [--yes] [--json]
niceeval run import <record-file> [--json]
niceeval run export --run <run-id> [--run <run-id>...] --out <file> [--json]
niceeval invocation list [--all] [<experiment-prefix>] [--json]
niceeval invocation show <invocation-id> [--json]
```

凡显式传入 Run ID 都要求 exact identity，不接受前缀、`latest` 或隐式当前 Run。`recover --orphaned` 是显式的集合恢复入口，按下文冻结完整 ID 集合，不把 selector 当作 Run ID。

`run list` 在一个 PublicationCutoff 下列出已经提交 create transaction 且未删除的 Run。每项显示 state、Experiment、
开始/结束时间、`published / expected` coverage 与 invocationId。`active` 的空 Planned attempt 显示 pending；终态空 Planned attempt 显示
闭合 absence reason。

列表按开始时间从新到旧排列，开始时间相同时按 Run ID 升序。过滤只缩小列表，不改变任何 Run：

| 选项 | 规则 |
|---|---|
| `--state <state>` | 可重复，取值为 `active`、`recovering`、`completed`、`interrupted`、`failed`；多个取值之间是“或” |
| `--experiment <id-prefix>` | 按 Experiment ID 的路径前缀匹配 |
| `--invocation <invocation-id>` | exact Invocation ID |
| `--limit <n>` | 正整数；只保留排序后最前面的 n 项。省略时不截断 |

不同选项之间是“且”。`--limit` 截断时，Human 输出末尾写出被省略的数量。

`run list --json` 的 `run.list` document 相应增加两处，其余字段不变：

```ts
interface RunSummary {
  // ……既有字段
  /** 只在 state 为 active 或 recovering 时出现。 */
  readonly owner?: {
    readonly state: "alive" | "gone" | "unknown";
    /** state 为 unknown 时的具名原因。 */
    readonly reason?: "other-host" | "identity-not-recorded" | "portable-record" | "probe-failed";
    readonly observedAt: string;
  };
}

interface RunListDocument {
  // ……既有字段
  /** 同一 cutoff 下满足过滤条件、因 --limit 未列出的数量；没有截断时为 0。 */
  readonly omitted: number;
}
```

`decodeRunDocument` 接受带这两处的 document；缺少 `omitted` 或出现表外取值时拒绝。Library 的 `runHost.list` 接受对应的过滤字段，结果带同样的两处；字段名见 [Run Library](library.md)。

每个 `active` Run 另带一项 owner 观察：

| 取值 | 含义 |
|---|---|
| `owner alive` | 同机、同启动与隔离域内，进程启动身份与封存身份相同 |
| `owner gone` | 按 recovery 判据证明封存的 owner 已终止；可请求 recover，执行时仍须重验 |
| `owner unknown` | 无法证明；例如 owner 在另一台机器上 |

三种观察分别映射 [recovery 判据](architecture/lifecycle.md#崩溃与-recovery) 的 `active`、`terminated` 与 `unproven`。heartbeat 只作诊断，不参与证明。
观察附带取证时间，不属于 PublicationCutoff 上的历史事实，也不授予恢复权限。只读 portable Record 不对当前机器取证，显示 `owner unknown`。
存在 `owner gone` 的 Run 时，Human 输出末尾给出 `Next: niceeval run recover --orphaned`。

`show run:<run-id>` 消费唯一 canonical Run Inspection operation `run.get`，不拼接多份近义 operation，也不使用 Run Host 自己的投影。结果包含 Run identity、state、
expected/published/missing、Planned attempt bindings、Attempt locators、absence、Verdict、score、Evidence、usage 与 limitations。

`run delete` 只接受终态 Run。目标仍为 `active` 时提示先 recover；存在 incoming reference 时零删除，并列出依赖
Run 与 Attempt locator。命令没有 `--force`、cascade 或按 selector 批量删除。
若关联 State 租约集合仍为 active/recovering，返回 `run-state-recovery-required`、零删除、非零退出；先按 [State 恢复](../state/cli.md#中断后恢复) 处理整个集合。

`run recover` 只在 NiceEval 能证明旧 owner 已终止时 fence writer generation 并把 Run 收口为 `interrupted`。
它先进入可检查、可重试的 `recovering`，再以匹配 generation 收口；证据不足时拒绝，且不删除任何已发布 Attempt。

`run recover --orphaned` 对每个 `owner gone` 的 `active` Run 执行同一个 recover，不接受其它选择条件。
上一次恢复中途被打断而停在 `recovering`、且恢复进程已经终止的 Run 同样纳入，由同一个 recover 从它停下的地方继续。
它先列出将要收口的 Run 并请求一次确认；`--yes` 跳过确认。`owner alive` 与 `owner unknown` 的 Run 原样跳过并各写出原因。

候选集来自当前项目的一次固定 cutoff，确认前冻结 exact Run ID 集合；确认后不加入新 Run。每项 mutation 在事务边界重新验证 state、精确 process identity 与 writer generation，不能复用列表的旧观察授权写入。

`--orphaned` 与位置 Run ID 互斥。`--json` 不请求交互确认，缺少 `--yes` 时零写入并非零退出。本入口只收口 Run，不释放 State 租约、不执行 Experiment after，也不销毁 Sandbox。

每个 Run 独立收口：某一个失败不撤销已经收口的 Run。全部可证明的 Run 都收口时退出码为 0，任一 recover 失败时非零。
没有可收口的 Run 时输出 `No orphaned runs` 并以 0 退出；候选全部被跳过时同样以 0 退出。`--json` 输出：

```ts
interface RunRecoverOrphanedDocument {
  readonly operation: "run.recover-orphaned";
  readonly items: readonly {
    readonly runId: string;
    readonly outcome: "recovered" | "skipped" | "failed";
    /** skipped 时是 owner 观察的取值与原因；failed 时是 RunRecoverError 的 code。 */
    readonly reason?: string;
  }[];
}
```

`session list` 默认只列 active Invocation；`--all` 加入已收口的 durable Session。`session show` 以 exact invocation ID
显示这次 Invocation 的 terminal projection、created Run IDs、completion 与 publication cutoff；它不会重新构建 live 面板，也不提供后台接管。

对 active Invocation，`invocation show` 还列出每个已派发、尚未发布的 Planned attempt，让另一个终端里的人或 agent 不必解读运行日志：

- Experiment ID、Eval ID 与从 1 开始的 Attempt 序号；
- 当前阶段及进入该阶段的时间。阶段取自 Runner 的 lifecycle，与 live 面板和 `show @<locator> timing` 使用同一组名称；
- Sandbox provider 名与 provider 原生的实例标识（例如 Instabox 的实例名、Docker 的容器名）。实例尚未创建或 Eval 不使用 Sandbox 时写明没有；
- 最近一条 Attempt detail 及其时间，与非 TTY Human 输出的 detail 行是同一份文本。

实例标识用于排查者以 provider 的原生 CLI 直连现场，NiceEval 不代理这次连接。这些行是 owner 进程随活动写入的非权威观察值，
与 heartbeat 同级：owner 被暂停时可以停止前进，读取方只按原样显示写入时间，不据此判断 Attempt 死活。
已发布的 Attempt 不再出现在这里，改由 `show @<locator>` 读取；排队中尚未派发的 Planned attempt 只按 Experiment 计数。
`--json` 输出同一组字段。凭据、env var 值与 Sandbox 内的文件内容不进入这些行。

`run import` 将外部已交付、已验证的单文件 Record 中的已发布 Run、Attempt 闭包、family 事实与 Content chunk 汇入当前项目数据库。
它只导入完整封口的已发布 Run。目标项目已存在相同 Run ID 且散列一致时幂等跳过；Run ID 冲突但内容不一致时完整拒绝且零写入。
导入成功后更新项目发布时钟，新汇入的 Run 立即对 Inspection 与后续沿用可见。

`run export` 将一个或多个选定 Run 及其传递依赖的 Attempt、family 事实与 Content chunk 导出为自洽的单文件 portable Record。
导出文件剔除未选中的历史 Run、未引用的临时状态与项目内部会话。输出文件自动完成只读完整性验证，可直接用于离线审计交付或跨机汇合。

canonical Record 固定为项目内 `.niceeval/record.sqlite`。受控退出会自动 close writer、checkpoint、truncate WAL，并以内建
只读验证通过后才成功。portable gate 仅由正在收尾的 Invocation 发起，且任何 active work 都会完整拒绝；该文件本身即可直接复制或归档。
跨机器分片汇合使用 `run import`，离线审计交付选定子集使用 `run export`；无需手工运行 `clean` 或 `migrate` 命令。

`show`、`compare`、`run list` 与 `view` 可以直接读取当前格式的 portable Record，无需先运行评估。
旧格式拒绝打开，并提示重跑或清理存储；原件不被改写。
`show --record <file>` 的外部输入必须是已交付、无并发修改的单文件 Record。未知格式、非空 WAL、损坏文件或无法证明的 owner 状态明确拒绝。
项目 operational 读取保留当前格式的实时事实；输入选择、原件保护与失败边界统一见 [格式准入](architecture/README.md#格式准入)。
