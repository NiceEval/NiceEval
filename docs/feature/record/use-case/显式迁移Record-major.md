# 显式迁移 Record

本用例说明旧 Record Core 与旧 RecordAttachment 怎样转换到当前安装版本。普通 reader 不自动迁移，也不提供跨 Core major compat mode。

## 两种 migration trigger

Core owner、引用、目录、完成判断或 shape 改变时，发布新的 `RecordFormatId`。普通命令遇到旧 major 时整体返回 `record-migration-required`。

某个 RecordAttachment 发布新 schema 时，不改变 Record major。请求 current family 的功能有三种结果：

| 旧 RecordAttachment | 读取状态 | migrate 的处理 |
|---|---|---|
| 到 current 的相邻边都是 converter | `migration-required` | 转换到 current schema |
| 路径有 `not-losslessly-migratable` 边 | `migration-unavailable` | 保留 exact old bytes |
| family 或 schema 未注册 | `unsupported` | 原样保留 |

前两种状态都可提示：

```sh
niceeval migrate --record <root>
```

未知 RecordAttachment 不是 migration-unavailable。安装 owning plugin 后才可能变成可识别的 family。

## 相邻版本链

每个 Core converter 只处理相邻版本：

```text
niceeval.record/v1 → v2 → v3
```

每个 RecordAttachment family 的每条相邻边也必须唯一：

```text
niceeval.verdict/v1 → converter → v2
niceeval.sources/v2 → not-losslessly-migratable → v3
```

禁止跳过中间版本。用户运行一次命令，NiceEval 根据当前安装的 Core 与插件 definitions 编排完整链。

每个 RecordAttachment family 的每个相邻边必须提供 converter，或明确声明 `not-losslessly-migratable`。第三方 converter 由定义该 RecordAttachment 的插件提供。

## Preflight

第一次写入前，命令：

1. exact decode source Core 与可识别的 RecordAttachment envelope；
2. 找到全部 Core 与 RecordAttachment converter 链；
3. 列出无法无损迁移和 unsupported 的 RecordAttachment；
4. 验证 ID、owner、引用和路径仍可表达；
5. 验证目标 identity 与目录无冲突；
6. 检查 Git restore point。

`.niceeval/record` 全部被当前 commit 跟踪且工作区干净时，Git 检查通过。否则命令显示风险并要求确认；非交互调用必须传 `--yes`。

preflight 失败不修改任何文件。明确不可无损迁移不是失败：plan 与 receipt 列出它，且执行保留原 bytes。

## Converter 边界

converter 只接收精确旧值并产生精确新值。它不能：

- 读取当前 Eval 或项目源码来补字段；
- 访问网络或进程变量；
- 重新运行 matcher、Assertion evaluator、reuse planning 或 Report；
- 生成新的业务事实；
- 更换仍表示同一对象的 RecordId、RunId、SlotId 或 AttemptId。

旧数据缺少新 schema 需要的事实时，target 可以显式表达 legacy unavailable。无法如实表达时，edge 声明不可无损迁移；命令保留旧 RecordAttachment，并让 current consumer 收到 migration-unavailable。

unknown 第三方 RecordAttachment 在 owner 仍可表示时原样保留。Core 新模型无法保持它的 owner 时，preflight 拒绝整次 migration。

## 执行与中断

命令取得 exclusive maintenance lock。每个相邻步骤完成后，磁盘形成该步骤的有效版本，然后才开始下一步。

v1→v2 已完成而 v2→v3 尚未开始时，root 是有效 v2，下次从 v2 继续。步骤内部中断可能留下混合状态，普通命令必须拒绝解释。

NiceEval 不另存旧 root、自动 backup 或 durable migration history。用户从 preflight 显示的 Git commit 或自己的备份恢复。

成功后 Git diff 是用户核对表示变化的入口。

## 相关阅读

- [显式 migration architecture](../architecture.md#显式-migration)
- [Migration Library](../library.md#migration-plan-与执行)
- [CLI migrate](../cli.md#migrate)
