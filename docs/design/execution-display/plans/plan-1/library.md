# 执行轨迹的应用展示 · plan-1 —— Library

## 调用形状

展示块是 `ctx.recordTrace()` 事件上的可选字段 `display`。
事件的其它字段由 [保存通用执行轨迹](../../../../feature/adapters/library.md#保存通用执行轨迹) 定义。

```ts
const image = await ctx.attach({ name: "frame.png", mediaType: "image/png", body: png });

await ctx.recordTrace({
  traceId: "game",
  schema: { id: "example.game/v1" },
  collection: { state: "complete", limitations: [] },
  scopes: [],
  events: [
    {
      key: "e1",
      type: "npc.said",
      source: { id: "game-server" },
      actor: { id: "npc:guard", label: "Guard" },
      summary: "Guard: Halt! Who goes there?",
      payload: { npcId: "guard", line: "Halt! Who goes there?", mood: "alert" },
      display: [
        { kind: "message", role: "assistant", speaker: "Guard", text: "Halt! Who goes there?" },
      ],
    },
    {
      key: "e2",
      type: "frame.rendered",
      source: { id: "renderer" },
      summary: "Rendered frame 12",
      display: [
        { kind: "image", artifactId: image.artifactId, alt: "Guard blocks the gate at dusk" },
        { kind: "fields", fields: [{ label: "frame", value: 12 }, { label: "ms", value: 41.5 }] },
      ],
    },
  ],
});
```

## 展示块

```ts
type ExecutionDisplayBlock =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "message";
      readonly role: "user" | "assistant" | "system" | "other";
      readonly speaker?: string;
      readonly text: string;
    }
  | {
      readonly kind: "fields";
      readonly fields: readonly {
        readonly label: string;
        readonly value: string | number | boolean | null;
      }[];
    }
  | { readonly kind: "code"; readonly language?: string; readonly text: string }
  | { readonly kind: "image"; readonly artifactId: string; readonly alt: string };

interface ExecutionTraceEventInput {
  // 其它字段：key、type、source、actor、time、summary、payload、links、evidence、scopeMemberships
  readonly display?: readonly ExecutionDisplayBlock[];
}
```

字段语义：

- `display` 省略表示该事件没有展示块。空数组非法，不能用来表达“有展示但为空”。
- 块按数组顺序呈现。顺序是展示意图，不证明因果。
- `text`、`message.text`、`code.text` 原样保存。不解释 Markdown、HTML 或 ANSI；换行 `\n` 与制表符 `\t` 保留。
- `message.role` 只决定人读样式（对齐、标签），不进入 conversation、usage 或 Judge 材料。`speaker` 省略时，renderer 用 role 的英文标签。
- `fields.value` 只接受标量。数值必须有限；renderer 按 JSON 数字原样显示，不格式化单位或小数位。
- `code.language` 是显示提示（如 `"sql"`、`"shell"`），不触发语法高亮依赖或执行。
- `image.artifactId` 必须是同一 Attempt 已由 `ctx.attach` 接纳的附件，且 `mediaType` 属于 `image/png`、`image/jpeg`、`image/webp`、`image/gif`。
  接纳时 NiceEval 从附件 descriptor 复制并固定 `mediaType`、`byteLength` 与 `sha256`。媒体类型是标签，不证明 bytes 可解码。
- `alt` 必填，是终端与无障碍读者看到的内容。

展示块与 `payload` 相互独立：payload 是领域事实，供 Adapter parser 与精确证据使用；展示块是同一事实的人读形式。
NiceEval 不校验二者一致，也不从 payload 自动生成展示块。

## 轨迹保存在外部系统

应用自己保存完整轨迹时，Adapter 提交一份只含一个事件的快照，用展示块说明去哪里看：

```ts
await ctx.recordTrace({
  traceId: "rpg",
  schema: { id: "example.rpg/v1" },
  collection: {
    state: "partial",
    limitations: [{ code: "external-trace", message: "Full trace is stored by the RPG server." }],
  },
  scopes: [],
  events: [
    {
      key: "run",
      type: "rpg.run",
      source: { id: "rpg-server", eventId: "run_8f2c" },
      summary: "Full trace stored by the RPG server: run_8f2c",
      payload: { runId: "run_8f2c" },
      display: [
        { kind: "text", text: "The full trace is stored by the RPG server. Query it with:" },
        { kind: "code", language: "shell", text: "rpg-cli trace show run_8f2c" },
      ],
    },
  ],
});
```

- `collection.state` 写 `partial`，并用 limitation 说明完整轨迹在外部。Record 里没有的事件不能报成 `complete`。
- 命令只是不可信的应用文本。NiceEval 不执行、不自动打开、不做 shell 求值，也不验证外部系统里的数据是否存在。
- 外部 ID 拼进命令前，Adapter 负责限定字符集或按目标 shell 正确引用，防止复制后执行额外命令。
- 命令里只能放可公开的标识，不能放 token、密码或签名 URL。外部系统需要认证时，由用户自己的凭据与 CLI 配置提供。
- 外部系统里的数据可能已被修改或删除。这件事 NiceEval 无法证明，Record 只保存提交时的指引。

## 限制与错误

| 项 | 上限 |
|---|---|
| 每事件块数 | 4 |
| 每事件展示总量（规范化 UTF-8） | 8 KiB，计入每 Attempt 64 MiB 规范化输入 |
| `fields` 项数 | 16 |
| outline 中每个文本字段与 `fields` 字符串值的预览 | 1 KiB（UTF-8，截在码点边界） |
| outline 中单个事件的序列化投影（含 envelope 与展示块） | 8 KiB |
| `label`、`speaker`、`language` | 128 UTF-8 bytes |
| `alt` | 512 UTF-8 bytes |

所有字符串必须是合法 UTF-8，不能含 U+0000–U+0008、U+000B–U+001F、U+007F–U+009F（即除 `\t`、`\n` 外的 C0/C1 控制字符）
或 U+2028/U+2029。`label`、`speaker`、`language`、`alt` 不能含换行。

违反任一规则时，整份快照被拒绝，`recordTrace` 返回的 Promise 被拒绝。
拒绝原因带具名 code `execution-display-invalid`，并指出违规位置 `events[i].display[j]` 与字段名。
此前已接纳的快照保留；Attempt 登记一次采集失败，Events section 因此显示 partial。
NiceEval 不静默截断，也不剥离字符后接纳。

展示块进入规范化快照，参与同 `traceId` 的幂等比较：展示块不同即冲突。
展示块不进入执行资格身份，见 [Architecture · 身份与复用](architecture.md#身份与复用)。

展示块与 payload 一样只能放已脱敏、可公开的内容。展示文本不是放宽 Record 内容边界的通道：raw provider frame、
hidden chain of thought 与 secret 同样不能写进展示块。
