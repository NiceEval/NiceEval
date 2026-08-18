# 显式 migration 与 Git 恢复

本页说明 `niceeval migrate` 怎样区分 Core 不兼容、已知 family 的升级与未知 future family。契约单源
始终在 [Record Architecture](../architecture.md) 和 [Record CLI](../cli.md#migrate)。

## schemaVersion `1` 的结果

完整 current Record 的 root 是：

```json
{ "format": "niceeval.record", "schemaVersion": 1 }
```

它没有已发布 predecessor，因此命令不写盘：

```sh
niceeval migrate --record .niceeval/record
# Record is already current: niceeval.record (schemaVersion 1)
```

兼容性不把所有未认识 bytes 混成一个错误：

| 发现的 bytes | 普通读取 | `migrate` |
|---|---|---|
| root / Core 与 current 不兼容 | `migration-required` 或 `unsupported-format` | 只在有固定相邻步骤时迁移 |
| 已知 family 的旧 schemaVersion | `migration-required` | 显式迁移该 known family |
| 未知独立 future family | 忽略且继续读取其它事实 | 保留 directory、payload 与 blob bytes |
| current catalog family 缺失 | 请求时 `not-recorded` | 不补写历史事实 |
| 带 `/vN` 后缀的未发布 family 草案 | `unsupported-format` | 不推测、也不迁移 |

未知 family 的局部容忍只保护可读的历史。它不能让 reader 解释 payload、验证 blob closure 或把事实交给
Report。`AnalysisInput` 或 `DomainViewRequest` 依赖该 family 时才返回 `unsupported`。

## future schema 的固定步骤

future root / Core schemaVersion `2` 发布时，NiceEval 必须同批提供固定 `1 → 2` maintenance step。已知
family 的 schemaVersion 升级也由固定、静态 definition 说明相邻步骤。步骤只处理保存的 Core、payload 与
own blob closure。

迁移可以重新编码 bytes、mint 新 blob ref 或重排 canonical object key。它不能：

- 读取当前 Eval、项目文件、网络或 provider 补缺失事实；
- 重新运行 matcher、Assertion evaluator、reuse planning 或 Report；
- 改写仍表示同一对象的 RecordId、RunId、SlotId 或 AttemptId；
- 接受第三方 converter、调用方 durable family 或物理字段；
- 解释、删除或重写未知 future family 的 bytes。

如果已知 bytes 不能如实形成目标 schema，迁移计划在写盘前拒绝。它不创建半有效目标格式，也不把 unknown
data 默默丢弃。

## Git preflight 与执行

有固定相邻步骤时，maintenance 先确认：

1. Record 位于 Git worktree，完整 portable inventory 由 HEAD 跟踪；
2. 该 inventory 在 index 和 worktree 中干净；
3. repository、HEAD、Record path、`recordId`、source inventory 与 migration implementation identity
   仍与计划相同。

通过后才执行：

```text
exclusive maintenance lease
        ↓
原地运行固定的相邻步骤
        ↓
完整校验 Core 与认识的 family closure
        ↓
未知 future family 保持原有 bytes
        ↓
完成后才允许新的 openRead
```

migration 是 maintenance 的内部工作，不是 family read，也不是 Analysis 或 Report 的输入。

## 中断后的唯一恢复路径

NiceEval 不创建 staging、backup、rollback、root replacement 或自己的恢复日志。被 kill、断电、I/O failure
或校验失败时，ordinary reader 不形成 reader session。

用户必须用 Git 把 `.niceeval/record` 的 tracked 与迁移新增内容完整恢复到预检显示的 commit，再重新运行
`niceeval migrate`。恢复后由新 preflight 再次判断格式和计划；工具不会从半完成的 known-family bytes 继续。

## 相关阅读

- [Record CLI](../cli.md#migrate)
- [固定 family 与 closure](../architecture.md#七个固定-attachment-family)
- [源码 Attachment 怎样安全演进](源码Attachment怎样安全演进.md)
