# 显式 migration 与 Git 恢复

`niceeval.record/v1` 和五个 `/v1` family 是首个支持格式，migration 链为空。本页定义 v1 的
`migrate` 反馈，以及发布 v2 时必须遵守的恢复边界。

契约单源始终在 [显式 migration 与 Git 恢复](../architecture.md#显式-migration-与-git-恢复) 和
[Record CLI](../cli.md#migrate)。

## v1 的结果

对完整 v1 Record，命令不写盘：

```sh
niceeval migrate --record .niceeval/record
# Record is already current: niceeval.record/v1
```

Core 或固定 family 不是支持的 v1 schema 时，命令返回 `unsupported-format`。它不会推测一个旧 layout、
执行第三方 code、读取当前 worktree，或把非支持 bytes 伪装成可迁移历史。

## 发布 v2 时的要求

发布 `niceeval.record/v2` 或任一个 family `/v2` 时，NiceEval 必须同批提供固定的 v1→v2 migration。
每一步只处理一个相邻版本，并且只依赖已保存的 Core、payload 和 own blob closure。

迁移可以重新编码 bytes、mint 新 blob ref 或重排 canonical array。它不能：

- 读取当前 Eval、项目文件、网络或 provider 补缺失事实；
- 重新运行 matcher、Assertion evaluator、reuse planning 或 Report；
- 改写仍表示同一对象的 RecordId、RunId、SlotId 或 AttemptId；
- 让第三方注册 converter、family 或物理字段。

如果 v1 bytes 不能如实形成 v2，迁移计划必须在写盘前拒绝。它不创建一个半有效 v2，也不把 unknown
data 默默丢弃。

## Git preflight 与执行

有固定相邻步骤时，maintenance 先确认：

1. Record 位于 Git worktree，完整 portable inventory 由 HEAD 跟踪；
2. 该 inventory 在 index 和 worktree 中干净；
3. `migration.in-progress` 不存在；
4. repository、HEAD、Record path、`recordId`、source inventory 和 migration implementation identity
   仍与计划相同。

通过后才执行：

```text
create + sync migration.in-progress
        ↓
原地运行固定的相邻步骤
        ↓
完整校验 Core、五个 family 和 blob closure
        ↓
remove + sync migration.in-progress
```

marker 存在时，普通 open、plan 和 migrate 都返回 `migration-interrupted`。它不是进度日志，也不是恢复
机制。

## 中断后的唯一恢复路径

NiceEval 不创建 staging、backup、rollback、root replacement 或自己的恢复日志。被 kill、断电、I/O
failure 或校验失败时，marker 保留，普通读取 fail closed。

用户必须用 Git 把 `.niceeval/record` 的 tracked 与迁移新增内容完整恢复到预检显示的 commit，再重新
运行 `niceeval migrate`。恢复后由新 preflight 再次判断格式和计划；工具不会从混合字节继续。

## 相关阅读

- [Record CLI](../cli.md#migrate)
- [固定 family 与 closure](../architecture.md#五个固定-attachment-family)
- [源码 Attachment 怎样安全演进](源码Attachment怎样安全演进.md)
