# LLM X

一个由 AI 驱动的 X/Twitter 应用，附带 NiceEval 自定义应用评估。

打开页面后，应用自动恢复 SQLite 中已有的时间线；数据库为空时才创建默认用户和首页内容。React 页面使用 Zustand 管理导航与交互状态，Next.js Route Handler 提供 Node 后端。用户可以浏览主页、进入推文详情、连续回复、发帖、刷新时间线和生成配图。

## 直接运行

本示例随 NiceEval checkout 开发，开发依赖指向仓库内的包。首次安装前，在仓库根运行 `pnpm run build:package`，再进入本目录：

```bash
pnpm install
pnpm build
pnpm start
```

打开 <http://127.0.0.1:4318>。开发时运行 `pnpm dev`。世界状态默认保存在 `.data/llm-x.sqlite`，可用 `LLM_X_DB_PATH` 指定其它 SQLite 文件。

验证命令：

```bash
pnpm typecheck
pnpm smoke
```

`smoke` 使用确定性内容检查创建、持久化、恢复、发帖、回复、刷新和失败原子性；它不会调用 NiceEval 或外部服务。

## 用 NiceEval 评估

应用自身不依赖 NiceEval。`evaluation/adapter.ts` 将 `defineAdapter` 封装成领域工厂 `defineX`，每 Attempt 创建游戏实例，并返回 `visitDiscoveryPage`、`viewProfile`、`post`、`reply`、`refreshFeed`、`generateImage` 等操作。
`evals/social-journey.eval.ts` 通过强类型的 `t.post()`、`t.reply()` 调用应用，直接把返回的 Post 交给 `evaluation/matches.ts` 中的 Match。方法签名和 Post 类型都由应用提供。

```bash
pnpm exec niceeval check
pnpm eval
pnpm exec niceeval view
```

默认只有 `fixture` 实验。它运行同一套应用状态逻辑，检查初始世界 → 带图发帖 → 回复 → 刷新动态 → 单独补图的完整路径，不调用付费服务。
图片检查只证明生成结果附在正确内容上，不评判画面质量；人物身份检查也不等同于语言风格一致性。需要语义质量时，另行声明 Judge 并提供实际文本或图像材料。
世界与主页检查先投影图片来源、是否存在和文字说明。直接匹配 Post 时，NiceEval 保存有界快照；它不是完整图片归档，画面质量需要显式的图像材料与判定。

对本地 NiceEval checkout 开发，在仓库根使用 `pnpm dev:link examples/zh/llm-x` 安装当前构建，再回到本目录运行上述命令。
真实模型评估可新增实验，使用同一个 `x`，将 `flags.provider` 设为 `live`，并明确声明 `model`、`flags.apiBase` 和 `flags.imageModel`，凭据只读取 `X_API_KEY`。
这个实验会在每次 Attempt 生成完整社交世界并调用生图，执行前需确认费用。没有采集的模型费用保持未知，不能将其当作零成本或声明总费用预算。

## Live provider

Live 模式通过服务端原生 `fetch` 调用 OpenAI-compatible API。文字使用 `POST /responses` 和严格 JSON Schema 输出；图片使用真正的 `POST /images/generations` 接口。协议选择对应官方 OpenAI 文档的 [Responses API](https://developers.openai.com/api/reference/cli/resources/responses/methods/create) 与 [GPT Image 模型支持的 Image generation endpoint](https://developers.openai.com/api/docs/models/gpt-image-2)。

在本目录 `.env` 中配置：

```dotenv
PROVIDER_MODE=live
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=<支持 Responses Structured Outputs 的模型>
OPENAI_IMAGE_MODEL=<支持 images/generations 的图像模型>
```

接口地址、文字模型和图片模型都可替换，以适配实现同一协议的公开服务。API key 只由 Node 后端读取，不会进入浏览器 bundle。首次创建会为每个人物生成一张图片，并最多生成两张首批推文配图；后续操作也可能继续调用生图，因此会产生真实费用。

如果 provider 不支持 `text.format.type=json_schema`、相应尺寸或返回格式，调用会明确失败。应用接受图片响应中的 `b64_json` 或 `url`。生成中的任何文字 schema 错误、未知人物/推文引用、生图失败或取消都会在提交前中止，不会污染已提交世界；并发操作通过 `revision` 检测冲突。`AbortSignal` 从公开应用 API 贯穿文字与图片 provider，并由 HTTP 客户端断开触发。

## Typed 应用 API

入口是 `src/index.ts`：

```ts
import {
  FixtureProvider,
  createWorld,
  generateImage,
  publishPost,
  refreshFeed,
  reply,
  viewProfile,
} from "./src/index.js";

const controller = new AbortController();
const game = await createWorld(
  { playerName: "小周", topic: "AI 时代的城市生活" },
  { provider: new FixtureProvider() },
  controller.signal,
);

const world = game.snapshot();
viewProfile(game, world.viewerId, controller.signal);
await publishPost(game, { intent: "提出一个关于夜间公交的问题", withImage: true }, controller.signal);
await reply(game, { postId: game.snapshot().posts[0]!.id, intent: "补充我的经历" }, controller.signal);
await refreshFeed(game, controller.signal);
await generateImage(game, { postId: game.snapshot().posts[0]!.id, prompt: "night bus, editorial photo, no text" }, controller.signal);
```

关键导出包括 `XGame`、`World`、`Profile`、`Post`、`ContentProvider`、`OpenAICompatibleProvider` 和各输入类型。`snapshot()` 返回深拷贝，调用方不能绕过应用规则修改内部状态。

## HTTP API

| 方法 | 路径 | 用途 |
|---|---|---|
| `POST` | `/api/world` | 以 `{ playerName, topic }` 原子创建/替换世界 |
| `GET` | `/api/state` | 读取当前世界 |
| `GET` | `/api/profiles/:id` | 读取人物主页及其动态 |
| `POST` | `/api/posts` | 以 `{ intent, withImage }` 生成并发布推文及后续互动 |
| `POST` | `/api/posts/:id/replies` | 以 `{ intent }` 生成回复及后续互动 |
| `POST` | `/api/feed/refresh` | 生成一批新的社交动态 |
| `POST` | `/api/posts/:id/image` | 以 `{ prompt }` 调用生图 provider 并给推文补图 |

所有写操作在 Node 后端串行执行，并在成功后写入 SQLite。当前仍是单用户应用，没有登录和多用户隔离。
