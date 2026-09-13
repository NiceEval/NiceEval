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

应用自身不依赖 NiceEval。`evaluation/adapter.ts` 将 `defineAdapter` 封装成领域工厂 `defineX`，每 Attempt 自动启动生产模式的 Next.js 后端，使用系统分配的本地端口和临时 SQLite 数据库。
`visitDiscoveryPage`、`viewProfile`、`post`、`reply`、`refreshFeed`、`generateImage` 全部通过与页面相同的 HTTP API 调用应用，读取结果使用应用 Schema 校验。`waitForReplies(postId)` 等待指定内容下出现其他人物的回复。
`evals/social-journey.eval.ts` 通过强类型的 `t.post()`、`t.reply()` 调用应用，直接把返回的 Post 交给 `evaluation/matches.ts` 中的 Match。方法签名和 Post 类型都由应用提供。

```bash
pnpm exec niceeval check
pnpm eval
pnpm exec niceeval view
```

`pnpm eval` 先构建应用再执行实验，无需手动启动服务器。直接执行 `pnpm exec niceeval exp fixture` 前需先运行 `pnpm build`，修改应用后也需重新构建。
Adapter 行为版本包含后端构建 ID，重新构建后不会携带旧构建的评估结果。
默认运行 `fixture` 实验。它通过真实后端检查初始世界 → 带图发帖 → 回复 → AI 后续回应 → 刷新动态 → 单独补图的完整路径，不调用付费服务。
跨请求读取验证 SQLite 中提交的状态；后台回复通过目标推文 ID 等待，不把其它动作引起的 revision 变化当作完成。Attempt 收尾会停止后端并删除本次临时数据库，不使用日常应用的 `.data/llm-x.sqlite`。
图片检查只证明生成结果附在正确内容上，不评判画面质量；人物身份检查也不等同于语言风格一致性。需要文本语义质量时，另行声明 Judge 并提供实际文本材料。
世界与主页检查先投影图片来源、是否存在和文字说明。直接匹配 Post 时，NiceEval 保存有界快照；它不是完整图片归档，本示例的文本 Judge 不判断画面质量。

对本地 NiceEval checkout 开发，在仓库根使用 `pnpm dev:link examples/zh/llm-x` 安装当前构建，再回到本目录运行上述命令。
### 真实模型与内容评分

配置下面的 `.env` 后，明确接受模型调用费用时运行 `pnpm eval:live`。命令自动构建并启动隔离后端，无需另开服务器。
`experiments/live.ts` 使用同一个 `x`，强制 `flags.provider: "live"`，从 `.env` 读取文字模型、图片模型和接口地址。
应用与 Judge 都只读取 `OPENAI_API_KEY`；可用 `OPENAI_JUDGE_MODEL` 单独指定裁判模型，否则使用文字生成模型。

`content-quality` 是 100 分的 Score Eval：发现页相关性 20 分、多样性 15 分、发帖遵循意图 25 分、
AI 回应上下文 20 分、人物一致性 20 分。相关性与多样性分别判断，避免一个笼统分数掩盖具体问题。
`t.reply()` 原样保存用户输入，不调用文字生成；真正的模型回应由后端后台生成并通过 `t.waitForReplies(reply.id)` 取得。用户原文只做保存检查，不贡献模型质量分。
Judge 接收真实生成的文本和明确的上下文，不用关键词命中代替语义质量。领域结构使用普通 Match，
发帖要求使用现成的 `instructionFollowing`，逐项判断后按满足比例计分；其余业务标准由 `defineJudge` 声明。两者都是 `ScoreMatch`，统一经 `check` 消费。
语义标准集中在 `evaluation/judges.ts`，调用点直接展示领域材料：

```ts
await t.check(reply, authoredReply(viewerId, post.id)).gate().orStop();
t.check({ instructions, output: post.content }, followsPostIntent)
  .score(25).label("发帖遵循意图");
```

世界生成 Schema 要求 4 至 12 条初始动态，后台续写 Schema 要求至少 1 条回复。评估仍在进入 Judge 前检查
真实 provider、发现页至少 4 条动态、post／reply 合法性、用户原文保存与人物回复至少 1 条。这些前置项都显式 `.gate().orStop()`；不满足时 Attempt 为 `failed` 并立即停止后续评分，不让无效材料得到成功的零分结果。

Score Eval 同样以 Verdict 作为通过／失败的唯一真相；分数完整度只说明数值能否计算。这里的前置 gate 失败时，Attempt 保持 `failed`，已经形成的连续 contribution 仍可供审计，不能把“有完整分数”解释成成功。
需要给任一 measurement 设置语义门槛时，写作 `t.judge(material, definition).gate(0.8)`。最低值、分值和 gate 都属于 Assertion handle，不改变 Judge 定义或请求字节。

一次 live Attempt 会创建完整世界（含真实头像与最多两张首批配图），再发帖、回复并等待 AI 回应；不额外要求帖子配图，不自动重试整次实验。
live 显式配置单请求 300 秒、后台回复等待 180 秒、整个 Attempt 900 秒的预算；fixture 保持单请求与回复等待各 60 秒。取消仍会终止本次后端并清理临时数据库。
图片存在不计入这 100 分。URL 或 alt 不能充当视觉输入；本评估不声称判断图片质量。
单次实验不能证明稳定质量；同模型自评也有偏差。没有采集的模型费用保持未知，不能将其当作零成本或声明总费用预算。

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
| `POST` | `/api/posts/:id/replies` | 以 `{ intent }` 原样保存用户回复，并在后台生成 AI 回应 |
| `POST` | `/api/feed/refresh` | 生成一批新的社交动态 |
| `POST` | `/api/posts/:id/image` | 以 `{ prompt }` 调用生图 provider 并给推文补图 |

所有写操作在 Node 后端串行执行，并在成功后写入 SQLite。当前仍是单用户应用，没有登录和多用户隔离。
