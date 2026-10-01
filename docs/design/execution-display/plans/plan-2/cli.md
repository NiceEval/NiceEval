# 执行轨迹的应用展示 · plan-2 —— CLI

## 命令

```sh
niceeval show @<locator> --execution [--actor <id>] [--type <event-type>] [--continuation <token>] [--expand <stable-id>]
```

机器读取使用 `niceeval query` 的 `attempt.trace` 与 `attempt.trace.detail`。

## 读取前提

`show --execution`、View 与 `query` 在打开 Record 后：

1. 在当前工作目录发现并求值 `niceeval.config.ts`；
2. 按 Attempt 的 Adapter identity 与事件快照的 `schema.id` 定位 Adapter 定义；
3. 动态 import 并对每个 Events section 事件执行 formatter。

`--record <snapshot>` 读取 Snapshot 时，展示同样来自当前目录的项目。

## 输出

outline 依次呈现 Events、Conversation、Commands 与 Diagnostics section，最后列出 Stable identities。每个 section 都显示自己的状态。

项目可加载且 formatter 成功时：

```text
$ niceeval show @01JGAMEATTEMPT --execution
Execution @01JGAMEATTEMPT
Events · complete
  evt_7Q2  npc.said  Guard
    Guard: Halt! Who goes there?
  evt_7Q3  frame.rendered  renderer
    [image] Guard blocks the gate at dusk
            image/png · 182.4 KiB · artifact art_91K
Conversation · not-recorded
Commands · not-recorded
Diagnostics · not-recorded
Stable identities
  event evt_7Q2
  event evt_7Q3
```

项目或 Adapter 不可加载时：

```text
$ niceeval show @01JGAMEATTEMPT --execution --record ./shared.snapshot
Execution @01JGAMEATTEMPT
Events · complete · display unavailable (adapter "game" not found in current project)
  evt_7Q2  npc.said  Guard
    Guard: Halt! Who goes there?
  evt_7Q3  frame.rendered  renderer
    Rendered frame 12
Conversation · not-recorded
Commands · not-recorded
Diagnostics · not-recorded
Stable identities
  event evt_7Q2
  event evt_7Q3
```

此时每个事件显示 envelope 与 `summary`；`--expand <eventId>` 显示 payload JSON。

| kind | 终端呈现 |
|---|---|
| `text` | 原文，按终端宽度折行 |
| `message` | `<speaker or role label>: <text>` |
| `fields` | label 列对齐 |
| `code` | 等宽，超宽截断并标 `…` |
| `image` | `[image] <alt>`，次行媒体类型、大小与 `artifactId` |

## 机器输出

`attempt.trace` 的 Events 项包含：

```ts
readonly display:
  | { readonly state: "resolved"; readonly blocks: readonly ExecutionDisplayBlock[] }
  | {
      readonly state: "unavailable";
      readonly code: "project-unavailable" | "adapter-not-found" | "formatter-missing" | "formatter-failed";
    };
```

`query` 与 `show`、View 走同一读取前提，因此 `query` 的结果同样取决于当前目录的项目。
