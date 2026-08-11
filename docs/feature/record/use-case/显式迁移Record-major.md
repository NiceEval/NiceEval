# 显式迁移 Record major

本用例说明旧 Record format 怎样转换到 current major。迁移作用于整个 Record major，不是只转换 Core，也不是升级业务 Channel schema。

## 何时需要 migrate

owner、引用、目录、Channel envelope、路径安全或原子发布单位改变时，NiceEval 发布新的 `RecordFormatId`。普通 reader 只打开 current major。

遇到已知且有完整 converter chain 的旧 major 时，`show`、`view` 与 `exp` 返回 `record-migration-required`，并提示：

```sh
niceeval migrate --record <root>
```

payload shape、typed view、Report 或 reuse policy 的变化不运行这条命令。它们分别由 Channel schema、projector 与 behavior identity 演进。

## 相邻版本逐步转换

```text
niceeval.record/vN
  → adjacent converter
  → exact validate vN+1
  → preservation inventory
  → repeat until current
```

Migration capability 只沿相邻 major 转换。每一步先在 local sidecar materialize 完整 target，再用目标版本 exact validator 检查。

转换可以改变物理目录与 Core 表示，但必须保留：

- `recordId`、RunId、SlotId 与 AttemptId；
- expected denominator、Member 与 origin/reference 关系；
- Channel 的 owner、name、schemaId、mediaType 与 collection；
- payload 与 blob closure 的事实内容和 digest。

converter 不运行 Channel projector、analysis selection、reuse planning 或当前业务算法。它也不补默认值，不把旧 Channel payload 改写成新 schema。

无法证明事实一一等价时，命令返回 `record-migration-not-lossless`，public root 保持 source format。

## 独占维护边界

Migration 取得 exclusive maintenance lease，再取得 source-version writer lock。存在 reader、writer 或 recovery 时，它 fail fast，不等待也不接管其它进程。

用户运行前应停止同一 root 的 `show`、`view` 与写入命令，并按自己的治理要求先用 Git 或备份保存可回退版本。

## 原地 cutover 与恢复

定义 public root 为 `R`，已验证 target 为 `N`，暂存旧 root 为 `O`：

```text
rename R → O
rename N → R
validate R
fsync R 与 parent
cleanup O、manifest、intermediate 与 cache
```

local migration manifest 保存 cutover 现场。进程在任一持久边界中断后，普通 open 返回 `record-migration-recovery-required`。

用户再次运行同一条 `niceeval migrate`。命令重新检查 `R`、`N`、`O` 的 format、`recordId` 与 digest，再完成安装或 cleanup。

成功后不保留 durable migration history、converter ID、旧 root 或 rollback state。NiceEval 不提供 `migrate --rollback`。

## 相关阅读

- [显式原地 migration](../architecture.md#显式原地-migration)
- [Record major migration Library](../library.md#record-major-migration)
- [CLI 显式迁移](../cli.md#显式迁移)
