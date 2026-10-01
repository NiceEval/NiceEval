# 执行轨迹的应用展示 · plan-2 —— Library

## 调用形状

```ts
import { defineAdapter } from "niceeval";

export const game = defineAdapter({
  name: "game",
  create(ctx) {
    // ctx.recordTrace({ ..., events: [{ type: "npc.said", summary, payload: { line, mood } }] })
    return { /* 应用方法 */ };
  },
  display: {
    "npc.said": (event) => [
      { kind: "message", role: "assistant", speaker: event.actor?.label, text: String(event.payload?.line) },
    ],
    "frame.rendered": (event) => [
      { kind: "image", artifactId: String(event.payload?.artifactId), alt: String(event.payload?.caption) },
    ],
  },
});
```

`recordTrace` 事件的字段由 [保存通用执行轨迹](../../../../feature/adapters/library.md#保存通用执行轨迹) 定义。

## formatter

```ts
interface ExecutionDisplayEvent {
  readonly eventId: string;
  readonly type: string;
  readonly schemaId: string;
  readonly actor?: { readonly id: string; readonly label?: string };
  readonly summary: string;
  readonly payload?: TraceJson;
}

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
      readonly fields: readonly { readonly label: string; readonly value: string | number | boolean | null }[];
    }
  | { readonly kind: "code"; readonly language?: string; readonly text: string }
  | { readonly kind: "image"; readonly artifactId: string; readonly alt: string };

type ExecutionDisplayFormatter = (event: ExecutionDisplayEvent) => readonly ExecutionDisplayBlock[];

interface AdapterDefinition {
  readonly name: string;
  readonly create: (ctx: AdapterContext) => unknown;
  readonly display?: Readonly<Record<string, ExecutionDisplayFormatter>>;
}
```

- `display` 的键是事件 `type`，精确匹配；没有对应键的事件以 envelope、summary 与 JSON 呈现。
- formatter 是同步纯函数，不接收 `ctx`，不能做 I/O。
- `message.role` 只决定人读样式。`speaker` 省略时，renderer 用 role 的英文标签。
- `fields.value` 只接受有限标量，renderer 按 JSON 原样显示。
- `code.language` 只是显示提示。
- `image.artifactId` 必须指向该 Attempt 的图片附件（`image/png`、`image/jpeg`、`image/webp`、`image/gif`）；`alt` 必填。

## 轨迹保存在外部系统

应用自己保存完整轨迹时，`recordTrace` 只提交一个带外部 ID 的事件，并把 `collection.state` 写为 `partial`。
formatter 根据 payload 生成指引：

```ts
display: {
  "rpg.run": (event) => [
    { kind: "text", text: "The full trace is stored by the RPG server. Query it with:" },
    { kind: "code", language: "shell", text: `rpg-cli trace show ${shellQuote(String(event.payload?.runId))}` },
  ],
},
```

项目不可加载时，读者只看到事件的 `summary`，因此 `summary` 本身应包含外部 ID。
命令只是不可信的应用文本，NiceEval 不执行它。`shellQuote` 由 Adapter 提供，负责按目标 shell 引用外部 ID；命令里不能放 token 或其它 secret。

## 限制与错误

| 项 | 上限 |
|---|---|
| 单次 formatter 执行 | 50 ms |
| 一次 `attempt.trace` 读取的 formatter 总时间 | 500 ms |
| 每事件块数 | 4 |
| 每事件展示总量（UTF-8） | 8 KiB，超出部分截断并标注 |

formatter 输出的字符串不能含除 `\t`、`\n` 外的 C0/C1 控制字符。

formatter 在独立的 worker 线程中执行，读取结束时终止该线程。同步代码无法被同一线程内的计时器中断，因此时限由终止 worker 兑现。
project 顶层代码与 formatter 闭包可以访问 Node 能力；“不接收 ctx”不构成沙箱。

formatter 抛错、超时或返回非法块时，该事件以 envelope、summary 与 JSON 呈现。
Events section 附加 limitation `execution-display-unavailable`，并带原因 code。读取本身不失败。
