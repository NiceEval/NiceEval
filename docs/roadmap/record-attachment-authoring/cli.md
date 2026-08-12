# RecordAttachment 作者 API —— CLI

## Application-installed world

第三方 definition 只有经 application config 的 `install` 集合才进入普通读取与 migration registry：

```ts
import { defineConfig } from "niceeval";
import { agentTrace, gpuEnergy } from "./record-attachments.ts";

export default defineConfig({
  recordAttachments: {
    install: [agentTrace, gpuEnergy],
  },
});
```

NiceEval CLI 另固定安装当前版本自己的 package-private built-in definitions。它们经过同一 registry compiler，但公共
config 不取得 writable official definition 或 namespace authority。

下列内容都不是 registry 输入：

- Eval、Experiment 或 Plugin 的 `recordAttachments.write`；
- 历史 link、manifest、provenance 或 Record bytes 中的 name / schemaId；
- Plugin factory、hook、Sandbox、Agent receiver 或 Report；
- package metadata、网络索引或按 name 推断的 dynamic import。

因此 `install` 表示应用愿意执行并信任普通 JavaScript definition / converter。它不授予 producer 写权限，也不是
第三方代码 sandbox。

## 读取不会隐式迁移

`niceeval show`、`view`、report 与 Library reader 只在 frozen Record view 中读取。安装 definition 后，known current
schema 可形成 `available`；known old schema 返回 `migration-required` 或 `migration-unavailable`，不会在 read path
修改 portable bytes：

| state | CLI / consumer 下一步 |
|---|---|
| `available` | 使用 exact decoded、plain-data frozen payload 与完整 blob closure |
| `unavailable` | 当前 owner 没有这份 Attachment；不等同于写失败 |
| `migration-required` | 用户可显式运行 `niceeval migrate` |
| `migration-unavailable` | 保留旧 bytes；使用旧版本 consumer 或发布新事实，勿重跑同一 edge |
| `unsupported` | 安装拥有该 definition 的可信 package；其它 facts 继续可用 |
| `invalid` | 检查该 Attachment 的 envelope / payload / refs / closure；其它 facts 继续可用 |

I/O、permission、closed reader、defect 与 interruption 保持 operation failure，不伪装成上述 data state。

## 命令

```sh
niceeval migrate [--record <root>] [--config <path>] [--yes]
```

`--config` 显式选择形成 application registry 的 NiceEval config。省略时沿用项目 config resolution；`--record` 只选择
实际 Record root，不暗示 converter package、安装位置或安全级别。

preflight 输出每份 Attachment 的 owner、name、from、to 与状态：

```text
RecordAttachments
  attempt/com.example.gpu-energy: v1 -> v2
  run/com.example.agent-trace: current v3

Migration unavailable
  attempt/com.example.measurement: v1 -> v2
    v1 did not record the measurement interval

Unsupported and preserved
  attempt/com.example.legacy-trace/v1
```

plan 绑定 canonical root snapshot、installed registry identity、完整 migration graph 与 Git inspection。任一输入变化后，
执行返回 `record-migration-plan-stale`，不能把旧 plan 用到新 bytes 或新 converter 上。

## Config 与 definition validation

CLI 在取得 maintenance lock、创建 sentinel 或写 portable bytes 前完成：

1. import config；
2. 验证每项是 genuine opaque definition；
3. 按 `(owner, name)` 拒绝重复 definition objects；
4. 验证所有 `vN` 连续、current 为最大版本；
5. 验证每个非 current version 恰有一个 adjacent migrate / unavailable edge；
6. exact-match Record 中每份 known Attachment 的 source schema 与 closure。

config throw、reserved namespace、伪造 definition、重复 owner/name、missing / extra / skip / reverse edge 或 invalid source
都以零 portable write 失败。CLI 不把这些错误延迟到某个 converter 已经执行后。

## Converter 与 target write

每次只执行一个相邻 edge。converter 收到 exact materialized source 和显式 target token：

```text
source RecordAttachmentValue<vN>
  → converter Effect<opaque target write, ConvertE, never>
  → target.value(payload)              # zero blob
     or target.create(blob builder)    # BlobE kept separately
  → shared schema/plain-data/closure validation
  → maintenance commit vN+1
```

`target.value()` 只是无 blob 的 `target.create()` 糖，仍经过 current target schema、plain-data、`blobRefs` 与 closure
validators。converter 不能提交 raw JSON、path、key、bytes 或另一个 family 的 write。

typed `ConvertE` 与 blob source `BlobE` 在内部保持各自的 failure channel。orchestrator 把它们包装为包含 owner、
family 与 edge 的 migration step failure。throw 仍是 defect，fiber interruption 仍是 Cause。任何 converter failure、blob failure、defect、
interruption 或 durable I/O failure 都停止命令并保留 sentinel。

`Effect` requirement 为 `never` 只表示 converter 不读取 NiceEval service。JavaScript closure 仍可能碰触 ambient Node
state，因此确定性、不读取 clock/random/environment/network/filesystem 是 extension 作者契约，不是 CLI 提供的隔离证明。

## Git 恢复点与 sentinel

第一次修改 portable bytes 前，CLI：

1. 检查 Record 是否位于可恢复的 Git worktree、portable files 是否由当前 commit 跟踪且干净；
2. 取得 exclusive maintenance lock；
3. exclusive create 并 sync root 下的 `migration.in-progress`；
4. 原地执行并 sync target attachments 与最终 `record.json`；
5. 最后删除并 sync sentinel。

有 Git restore point 时，preflight 显示精确 commit 后请求确认。无法证明 restore point 时，CLI 显示数据损失 warning；
非交互调用只有显式 `--yes` 才继续。`--yes` 只表示用户确认自己承担备份责任，不创建 backup、rollback、shadow copy、
output directory 或 migration history，也不能把 unavailable edge 变成 converter。

converter failure、I/O failure、defect、kill 或 interruption 留下 `migration.in-progress`。此后普通 open、plan 与
migrate 都 fail closed 为 `record-migration-interrupted`；用户必须从 preflight 给出的 Git commit 或自己的备份恢复，
不能直接重跑、删除 sentinel 或猜测中间版本。

## Producer 被删除以后

producer 与 definition 的 lifecycle 可以分开。删除已经不再运行的 Eval / Plugin 后，项目可保留一个只导出 definition
的 package 与 application install：

```ts
import { defineConfig } from "niceeval";
import { gpuEnergy } from "@example/niceeval-record-history";

export default defineConfig({
  recordAttachments: { install: [gpuEnergy] },
});
```

这允许 reader 继续解释历史 current facts，也允许 `niceeval migrate` 执行 family-owned edges；不会复活 producer、调用
Plugin factory 或授予任何新 write grant。definition package 不再可用时，unknown bytes 保持 `unsupported` 且原样保留。

## 反馈与错误

| code / state | 含义 | 下一步 |
|---|---|---|
| `record-attachment-definition-invalid` | installed definition 或 graph 非法 | 修正 config / definition；尚未写磁盘 |
| `record-attachment-registry-conflict` | 两个 objects 声明相同 `(owner, name)` | 只安装唯一 owning definition |
| `record-migration-plan-stale` | root、registry 或 Git inspection 已变化 | 重新运行 preflight |
| `attachment-migration-required` | known old schema 有完整 converter chain | 显式运行 `niceeval migrate` |
| `attachment-migration-unavailable` | graph 明确不能无损形成 current | 保留 bytes；使用旧 consumer 或发布新事实 |
| `record-attachment-migration-step-failed` | 某 family / edge converter 或 target blob 失败 | 从 Git / 备份恢复；修正 extension 后重新从恢复点开始 |
| `record-migration-interrupted` | sentinel 表示 root 处于不可确认的中间状态 | 从 Git / 备份恢复；勿直接重跑 |
| `RecordAttachmentRead.unsupported` | 当前 application 未安装 definition / schema | 安装可信 owning package；其它 facts 继续可用 |
| `RecordAttachmentRead.invalid` | envelope、payload、plain data、ref、blob 或 closure 无效 | 检查该 Attachment；其它 facts 继续可用 |
