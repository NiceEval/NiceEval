# 并行文档工作

Docs Work 把已经定稿的文档目标切成互斥写集，并为每份交付复用正式 lint。它不启动、选择、暂停或关闭 Agent；Herdr 是唯一调度器，操作者仍负责把 work item 交给独立 Agent 并完成验收。

```text
定稿的 docs scope
        │
        ▼
docs:work prepare
        │
        ├─ work item A ──▶ Agent A ──▶ scoped receipt
        ├─ work item B ──▶ Agent B ──▶ scoped receipt
        └─ work item C ──▶ Agent C ──▶ scoped receipt
                                      │
                                      ▼
                              single finalizer
                                      │
                                      ▼
                                  pnpm lint
```

## 运行状态

每次运行只写 Git ignored 的本地状态：

```text
.repo-tools/docs-runs/<run-id>/
├── run.json
├── items/<item-id>.json
└── receipts/<item-id>.json
```

这些文件是当次协作收据，不是设计、实施计划或第二套文档索引。`prepare` 从已经存在的 docs 边界、显式 scope 和 Git base 推导 work item；它不能让一份本地 run file 成为后续实现的目标 owner。

```ts
interface DocsWorkItemV1 {
  format: "niceeval.docs-work-item/v1";
  runId: string;
  id: string;
  goal: string;
  baseCommit: string;
  read: readonly string[];
  write: readonly string[];
  blockedBy: readonly string[];
  checks: readonly DocsCheck[];
  finalizerOnly: readonly string[];
}

type DocsCheck =
  | { kind: "docs-lint"; paths: readonly string[] }
  | { kind: "docs-site-lint"; paths: readonly string[] }
  | { kind: "command"; script: string; args: readonly string[] };
```

路径都使用仓库相对的规范形式。glob 必须能展开为有界 owner；绝对路径、`..`、symlink escape 和空写集在生成 item 前失败。

## 切片规则

两个并行 item 的 `write` 与 `finalizerOnly` 必须完全不相交。任一 item 的 `write` 也不能命中另一 item 的 `read`；后一项确实要读取前一项输出时，必须声明 `blockedBy` 并串行执行。`read` 之间可以重叠，但 item 保存共同的 `baseCommit`；检查时如果依赖文件已被别的 Agent 修改，receipt 标记 `previous-result`，不能把旧检查当作通过。

适合并行的边界包括：

- 不同 Feature、Roadmap 或 Engineering 主题；
- 不同 use-case 叶子；
- 已经裁决的禁词命中按互斥目录修正；
- 不同生成器的独立输出；
- 链接、索引与源码映射的只读盘点。

以下工作必须由单一 owner 或 finalizer 串行完成：

- 同一 Feature Design Package 的领域模型与共享结构；
- `docs/concepts.md`、`docs/writing-rules.json` 和目录入口索引；
- Feature 与 Roadmap 之间的采用迁移；
- 中英文契约源尚未固定时的双向改写；
- 多个 item 都会生成的同一输出。

一个 Feature Design Package 默认是最小写入 owner。只有叶子页面使用已经固定的共同模型，且 `write` 不相交时，才继续切分。

## 命令面

```text
pnpm docs:work prepare --scope <path> [--base <commit>] [--json]
pnpm docs:work show <run-id> [--json]
pnpm docs:work check <run-id> <item-id> --report [--json]
pnpm docs:work check <run-id> <item-id> --verify <receipt> [--json]
pnpm docs:work finalize <run-id> [--json]
```

命令面不提供 `claim`、`start-agent`、`wait` 或 `finish`。这些动作会与 Herdr 的真实 agent / pane 状态形成第二套调度状态。work item 的“负责人”和执行状态由 Herdr 与父 Agent 管理；Docs Work 只保存可重新执行的输入和检查收据。

`prepare` 检查所有读写集、依赖图和 shared finalizer 边界，再一次性写完整 run。`show` 只读取本地状态。`check` 只缩小输入路径，规则实现仍来自 `lint/docs/**` 或 `lint/docs-site/**`，不得复制 lint。

worker 只能运行 `check --report` 并产生 `reported` receipt。父 Agent 完成 Herdr 的 wait、get/read 和独立 diff 验收后，运行 `check --verify <receipt>`；工具重新执行同一检查并产生 `verified` receipt。pane 的 idle / done、完成通知与 worker 自己的绿色检查都不能产生 `verified`。

`finalize` 要求每个 item 都有匹配 run ID、item ID、base 与当前内容 digest 的 `verified` receipt，且依赖 item 已先通过。随后由一个 finalizer 更新共享索引和生成物，并运行完整 `pnpm lint`；它不把多份 diff 自动合并，也不替父 Agent 接受 worker 交付。

## 收据与重试

```ts
interface DocsWorkReceiptV1 {
  format: "niceeval.docs-work-receipt/v1";
  runId: string;
  itemId: string;
  baseCommit: string;
  checkedAt: string;
  readDigest: string;
  writeDigest: string;
  changedPaths: readonly string[];
  status: "reported" | "verified";
  reportedReceipt?: string;
  checks: readonly {
    kind: DocsCheck["kind"];
    status: "passed" | "failed";
    summary: string;
  }[];
}
```

每个 run 和 item 使用锁与同文件系统原子替换。相同 item 可重复 `check`，新 receipt 完整替换旧 receipt；失败保留最后一次成功收据，并在命令输出中返回失败事实。内容变化会改变 digest，使旧成功收据失效。

Agent 中断、pane 退出或 Herdr 报告 idle 都不改变 Docs Work 状态。父 Agent 按 Herdr 规则读取交接、独立重跑 `check`，验收通过后才允许 finalizer 消费该 receipt。

## 失败语义

`prepare` 对路径冲突、依赖环、共享文件被普通 item 拥有、未知 lint owner 和脏 base 聚合报错，零写入。`check` 对越界改动、`previous-result` base、缺失依赖或 lint 失败返回具名失败，不修改 docs。

`finalize` 发现 receipt 缺失或失效时只报告阻塞 item；发现最终完整 lint 失败时保留所有 scoped receipt，但不宣称 run 完成。操作者修正对应 owner 后重跑 check 与 finalize，不新建一份平行计划。
