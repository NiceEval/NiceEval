# AI SDK v7 助手(接入前)

这是一个**普通的 AI SDK v7 工具循环应用**:系统提示 + 四个工具(查天气 / 算数 / 搜索 /
发邮件)+ 一次 `generateText` 调用,进程内直调、不起服务,不接任何观测或 eval 框架。

它是 [`examples/zh/ai-sdk-v7`](../ai-sdk-v7/) 的接入前快照——两个目录的 diff 就是接入
niceeval(会话、事件流、HITL、tracing、断言)需要改动的全部内容。想看接入 niceeval 具体
要加什么,直接 diff 这两个目录:

```sh
diff -ru examples/zh/ai-sdk-v7-before examples/zh/ai-sdk-v7
```

## 目录结构

- `agent/assistant.ts`:系统提示、四个工具、一个 `chat(messages, modelId?)` 函数。
  `send_email` 带 `needsApproval: true`(AI SDK v7 的 tool approval),调用方需要自己把
  `tool-approval-response` 塞回 `messages` 再召一次。
- `agent/models.ts`:模型注册表,OpenAI 兼容的两家 provider。

## 跑起来

这个目录是一个**独立的 npm 项目**(自带 `package.json`)。

```sh
cd examples/zh/ai-sdk-v7-before
pnpm install
cp .env.example .env   # 填 DEEPSEEK_API_KEY / OPENAI_API_KEY
```

```ts
import { chat } from "./agent/assistant.ts";

const result = await chat([{ role: "user", content: "北京天气怎么样?" }]);
console.log(result.text);
```
