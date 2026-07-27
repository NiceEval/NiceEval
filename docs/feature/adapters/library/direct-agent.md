# Direct Agent

runner 直接调用函数、SDK 或服务端点时，使用 `defineAgent`。目标可以在当前进程，也可以是远程服务；
Direct 描述调用拓扑，不描述部署位置。Adapter 知道应用协议，NiceEval 不定义通用 URL、鉴权或消息格式。

```ts
import { defineAgent } from "niceeval/adapter";

export default defineAgent({
  name: "support-bot",
  async send(input, ctx) {
    const response = await fetch(`${process.env.SUPPORT_BOT_URL}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...ctx.telemetry?.headers,
      },
      body: JSON.stringify({
        message: input.text,
        sessionId: ctx.session.id,
        responses: input.responses,
      }),
      signal: ctx.signal,
    });

    const body = await response.json();
    ctx.session.capture(body.sessionId);

    return {
      status: body.waiting ? "waiting" : "completed",
      data: body.output,
      events: toStreamEvents(body),
      usage: body.usage,
    };
  },
});
```

## 配置边界

- URL、鉴权和应用私有参数由 Adapter 从 env 或闭包读取。
- model、reasoning effort 和实验 flags 从 `ctx` 读取。
- `ctx.signal` 必须传到网络请求或 SDK 调用。
- 应用支持 W3C propagation 时，把 `ctx.telemetry.headers` 合并进请求头；这只关联 trace，不改变事件转换。

## 会话

服务端保存历史时，将 `ctx.session.id` 发给应用，并把响应中的稳定 ID 传给 `capture()`。无状态服务需要重发完整历史时，使用 `ctx.session.history<T>()`。两种模式不应同时各自维护一份会话真相。

## 结构化转换

应用返回某个已支持 SDK 的结果或原生事件时，使用对应 [`sdk/`](../sdk/README.md) 转换器。转换器只处理协议字段，fetch endpoint、请求体和应用审批接口仍在本文件中。

应用协议是私有形状时，`toStreamEvents` 可以是项目自己的纯函数。它应以 fixture 测试消息顺序、并发工具配对、失败、拒绝、异常结束和 usage。

## 进程内调用

进程内函数也可以包在 `defineAgent` 中，但它测到的是函数边界，而非用户真实经过的 HTTP、鉴权、序列化和部署链路。只有被测循环本身就是目标边界时才使用这种方式；否则优先走生产协议。

## 文件输入

`TurnInput.files` 是可选附件。Direct Adapter 可以编码到应用请求体；应用不支持多模态时允许忽略文件并继续处理文本，但不能返回伪造的文件理解事件。
