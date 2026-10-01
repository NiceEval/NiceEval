# 执行轨迹的应用展示 · plan-1 —— CLI

## 命令

```sh
niceeval show @<locator> --execution [--actor <id>] [--type <event-type>] [--continuation <token>] [--expand <stable-id>]
```

机器读取使用 `niceeval query` 的 `attempt.trace` 与 `attempt.trace.detail`。

## outline

outline 依次呈现 Events、Conversation、Commands 与 Diagnostics 四个 section，最后是 Stable identities。
每个 section 都出现，并在标题中给出自己的状态；没有采集到事实的 section 显示 `not-recorded`。
section 的状态、预算与分页规则见 [Architecture · Section](architecture.md#section)。

Agent Attempt：

```text
$ niceeval show @01JAGENTATTEMPT --execution
Execution @01JAGENTATTEMPT
Events · partial
  Page  end of selected events
  evt_9A1  agent.user-message  claude-code
    Fix the failing test in src/math.ts
Conversation · complete
  Turn turn_1
    item_3A  user message
      Fix the failing test in src/math.ts
    tool_8C  Bash
      input   pnpm test
      result  exit 0 · 12 passed
Commands · complete
  cmd_2F  pnpm test · exit 0 · 4.1 s
Diagnostics · not-recorded
Stable identities
  event evt_9A1
  item item_3A
  tool occurrence tool_8C
  command cmd_2F
```

只有通用轨迹的 Attempt：

```text
$ niceeval show @01JGAMEATTEMPT --execution
Execution @01JGAMEATTEMPT
Events · complete
  Trace game · producer complete · 3 events
  Page  end of selected events
  evt_7Q2  npc.said  Guard
    Guard: Halt! Who goes there?
  evt_7Q3  frame.rendered  renderer
    [image] Guard blocks the gate at dusk
            image/png · 182.4 KiB · artifact art_91K
            niceeval show @01JGAMEATTEMPT --execution --expand evt_7Q3
    frame  12
    ms     41.5
  evt_7Q4  http.request  api
    method   POST
    path     /v1/orders
    status   201
    latency  83
Conversation · not-recorded
Commands · not-recorded
Diagnostics · not-recorded
Stable identities
  event evt_7Q2
  event evt_7Q3
  event evt_7Q4
```

轨迹保存在外部系统（见 [Library · 轨迹保存在外部系统](library.md#轨迹保存在外部系统)）：

```text
$ niceeval show @01JRPGATTEMPT --execution
Execution @01JRPGATTEMPT
Events · partial
  Trace rpg · producer partial · 1 event
    Limitation  external-trace · Full trace is stored by the RPG server.
  Page  end of selected events
  evt_4D1  rpg.run  rpg-server
    The full trace is stored by the RPG server. Query it with:
    rpg-cli trace show run_8f2c
Conversation · not-recorded
Commands · not-recorded
Diagnostics · not-recorded
Stable identities
  event evt_4D1
```

Stable identities 每行只有一个标签和一个 ID。标签是 `event`、`evidence`、`item`、`tool occurrence` 与 `command`。
不同类型的 ID 分别列出，不按字符串合并；某类 ID 超出 index 预算时，以 `… N more <label>` 报告遗漏。

## 展示块呈现

| kind | outline 中的呈现 |
|---|---|
| `text` | 原文，按终端宽度折行 |
| `message` | `<speaker or role label>: <text>`，续行对齐冒号后 |
| `fields` | label 列按块内最长 label 对齐 |
| `code` | 等宽，不折行；超出终端宽度的行截断并标 `…` |
| `image` | `[image] <alt>`；次行媒体类型、大小与 `artifactId`；再一行给出展开该事件的命令 |

outline 中省略分两种，标记互不相同：

- 文本超过 Inspection 预览上限时，标为 `… (N more bytes, --expand <eventId>)`。N 来自 Inspection result。
- `code` 行超过终端宽度时只标 `…`。这只是显示宽度省略，源文本完整，展开即可看到。

`--expand <eventId>` 显示完整展示块，再显示 payload JSON、links、scope 与 evidence。
展开后的 `code` 原样逐行输出，不折行、不截断、不加前缀，可以直接复制。
`image` 展开后显示 `niceeval query run --request -` 读取该附件的完整请求：

```text
printf '%s' '{"protocol":"niceeval.query/v1","operation":{"kind":"attempt.artifact","locator":"@01JGAMEATTEMPT","artifactId":"art_91K"}}' \
  | niceeval query run --request -
```

终端不内联图像。

`--expand` 接受 `eventId`、`evidenceId`、`itemId`、`toolOccurrenceId` 与 `commandId`，各自返回所属 section 的 detail。
`t1.c1`、`cmd1`、导入 key、原生 source eventId 与数组位置都不能展开；找不到时返回 selection error，不猜相邻项。

## 没有展示块的事件

事件没有 `display` 时，Events section 显示 envelope 与 `summary`；`--expand` 显示 payload JSON。
不提示缺少展示，也不从 payload 推导展示。

## 安全呈现

Events section 的所有人读字符串都经过同一终端处理：summary、actor label、limitation message、展示块文本、`label`、`speaker`、`alt`。
处理按 Unicode 码点进行，去掉除 `\t`、`\n` 外的 C0/C1 控制字符与双向格式控制字符，不改动合法 UTF-8 字节序列。
这些字符在写入时已被拒绝；终端处理同样作用于历史 Record 与其它 producer 的字符串，不改变 Inspection result。

## 机器输出

`attempt.trace` 的 Events 项包含：

```ts
readonly display:
  | { readonly state: "absent" }
  | { readonly state: "present"; readonly blocks: readonly ExecutionDisplayBlockPreview[] };

type PreviewText = { readonly preview: string; readonly omittedBytes: number };

type ExecutionDisplayBlockPreview =
  | { readonly kind: "text"; readonly text: PreviewText }
  | {
      readonly kind: "message";
      readonly role: "user" | "assistant" | "system" | "other";
      readonly speaker?: string;
      readonly text: PreviewText;
    }
  | {
      readonly kind: "fields";
      readonly fields: readonly {
        readonly label: string;
        readonly value: PreviewText | number | boolean | null;
      }[];
    }
  | { readonly kind: "code"; readonly language?: string; readonly text: PreviewText }
  | {
      readonly kind: "image";
      readonly artifactId: string;
      readonly alt: string;
      readonly mediaType: string;
      readonly byteLength: number;
      readonly sha256: string;
    };
```

`fields` 中的字符串值同样以 `PreviewText` 交付。`omittedBytes` 按 UTF-8 字节计，preview 截在码点边界。

`attempt.trace.detail` 的 `execution-event` selector 交付完整展示块：文本字段是完整字符串，`fields` 字符串值是完整字符串。
由 Conversation 投影进 Events 的项，以及 Conversation、Commands、Diagnostics 项，`display` 都是 `absent` 或没有该字段，形状由各自 section 定义。
