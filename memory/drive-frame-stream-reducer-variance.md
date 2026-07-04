# driveFrameStream 单型参时 reducer 与传输帧联合类型不兼容

## 现象

`examples/zh/tier1/pi-sdk` 在 a279def(三段式官方件)落地后就无法通过 `tsc --noEmit`:

```
agents/pi-sdk.ts: error TS2345: Argument of type 'PiAgentStream' is not assignable
to parameter of type 'FrameReducer<PiFrame>'.
  Type 'PiFrame' is not assignable to type 'PiAgentEventLike'.
    Type '{ type: "server_error"; message: string }' is not assignable ...
```

claude-sdk / codex-sdk 不报——纯属侥幸:它们的 `XxxLike` 形状足够松,传输帧恰好结构兼容;
pi 的 `PiAgentEventLike.message` 是对象形状,和传输帧的 `message: string` 撞了才暴露。
根 `pnpm run typecheck` 只 include `src`/`bin`,examples 各有自己的 tsconfig,这个错不进 CI 视野。

## 根因

`driveFrameStream<Frame>(cursor: SseFrameCursor<Frame>, reducer: FrameReducer<Frame>, …)`
单型参强制 cursor 和 reducer 同型。但 adapter 的惯用法是给流的帧类型加自己的传输帧联合
(`type PiFrame = AgentEvent | TransportFrame`),而 SDK 转换器只声明认识原生帧。方法双变
(method bivariance)也救不了:两个方向的赋值都不成立(松形状 ⇏ 严联合,传输帧 ⇏ 松形状)。

## 修法

运行时契约本来就是「reducer 对认不出的帧返回 `[]`,传输帧由 `onFrame` 处理」,类型如实放开:
`driveFrameStream<Frame, RFrame = Frame>` 两个型参独立推导,内部 `frame as unknown as RFrame`
喂 reducer(src/agents/streaming.ts)。适用于任何「reducer 只覆盖流的子集」的场景。

代价:reducer 与 cursor 之间不再有类型约束(传错 reducer 编译器不拦)——可接受,因为契约上
任何 FrameReducer 都合法。另:examples 的 tsconfig 独立于根 typecheck,改 `niceeval/adapter`
公开 API 后要手动对 `examples/zh/tier1/*` 逐个 `npx tsc --noEmit`,否则这类破坏静默存在。
