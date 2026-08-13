# CLI

CLI 选择 Record 与 Report、展示 closed execution，并由平台执行显式 migration。普通命令不会静默改写历史。

## show

```console
niceeval show
niceeval show --run <run-id>
niceeval show --report ./reports/memory.tsx
niceeval show --source <locator>
niceeval show --timing <locator>
```

`show` 执行以下步骤：

1. 从同一个 frozen Record view 形成 `ReportSample`。
2. 选择项目 Report；没有配置时使用有实际结果摘要的官方 Report。
3. 只执行请求的 Page / slice。
4. 把 closed semantic tree 渲染成 terminal face。

`--source` 与 `--timing` 选择官方 Analysis / Page 能力，不切换到 raw Record reader。它们与普通 Report 共用同一个 frozen
Sample、Evidence refs 与 Page failure isolation。

## view

```console
niceeval view
niceeval view --run <run-id>
niceeval view --report ./reports/memory.tsx
```

每个页面请求建立一份 `ReportExecution`。不同请求不承诺共享 Analysis cache；每个请求仍只读一个 frozen Sample，并生成闭合
semantic tree。Report module 变更触发下一次请求重新装载，不改变已发布事实。

## Static export

```console
niceeval view --out ./report
niceeval view --run <run-id> --out ./report
```

host 在一次 execution 中枚举目标 Page instances，共享 exact field cache，并把所有 closed trees 渲染到 staging directory。
全部页面与 assets 验证成功后才发布目标目录。

## migrate

用户运行 migration，但不编写 converter：

```console
$ niceeval migrate
Record v1 → v2
Metric envelope v1 → v2
Score envelope: already current
Unknown envelope niceeval.future/v3: preserved

2 runs, 41 facts, 3 blobs
Recovery point: Git working tree clean
Run again with --yes to apply this exact plan.

$ niceeval migrate --yes
Migration complete.
Receipt: 01K2...
```

### Preflight

`niceeval migrate` 只读检查：

- exact Record root 与 source snapshot identity；
- maintenance lock 可得性；
- Git working tree 与恢复点；
- Core 与每个固定 envelope 的相邻平台 converter；
- unknown envelope 的 exact bytes 与完整 blob closure；
- staging 与最终发布所需磁盘空间。

结果是一份 opaque `RecordMigrationPlan`。终端 summary 不能反序列化回 executable plan。

### Authorization

`--yes` 只批准刚形成且仍与 source snapshot 一致的 plan。CLI 重新验证 root、snapshot、Git safety 与 converter set；任一项改变都
返回 `migration-plan-stale`，要求重新运行 preflight。

application config 不接受 `defineMigration()`、converter registry、family installation 或 package callback。

### Publication

migration 在 staging snapshot 中完成全部 converter、unknown closure carry-forward 和全图验证。任何一步失败都不替换 source。
成功后执行原子发布，并写入 `RecordMigrationReceipt`。

receipt 逐固定信封给出：

```ts
type MigrationOutcome =
  | { readonly state: "migrated"; readonly from: string; readonly to: string }
  | { readonly state: "already-current"; readonly version: string }
  | { readonly state: "preserved"; readonly schema: string };
```

失败或中断不产出 receipt。

## Read behavior

| 读取状态 | `show` / `view` | 下一步 |
|---|---|---|
| Core 或固定 envelope 需要已知迁移 | 返回 `migration-required` | 运行 `niceeval migrate` |
| unknown future envelope 可保留但不可解释 | generic inventory 显示 `unsupported` | 用支持该 definition 的 package / NiceEval 版本分析 |
| definition snapshot 与 import 不兼容 | 返回 `capture-definition-incompatible` | 恢复 exact-compatible definition 或发布 Analysis bridge |
| blob closure 不完整 | 返回 `record-invalid` | 从恢复点还原；不能通过 migration 猜测内容 |

普通 read 不自动迁移，不运行第三方代码，也不把 `unsupported` 当作 missing。

## Historical reanalysis

```console
niceeval show --report ./reports/new-analysis.tsx --run <old-run-id>
```

该命令用新的 Analysis fields 与 Report callback 读取旧 frozen facts。它不向旧 Attempt 写回 Score，也不改变 fact identity。
definition exact-compatible 时可以重新分析；不兼容时 fail closed。

## Exit behavior

| 情况 | exit status | 是否改盘 |
|---|---:|---|
| `show` / `view` 成功 | 0 | 否 |
| Page / Analysis 失败 | 非 0 | 否 |
| migration preflight 成功 | 0 | 否 |
| migration 需要确认 | 0 | 否 |
| migration apply 成功 | 0 | 是，原子发布 |
| migration apply 失败 | 非 0 | source 不变 |

所有失败都打印 error code、root / Page / definition identity、失败阶段与可执行下一步。
