# 编写自定义 Adapter

自定义 Adapter 把被测应用的原生操作带进 eval。它不是 Agent，也不需要把应用伪装成对话。
`defineAdapter` 的 `create` 返回一个普通对象；对象的顶层方法会出现在由该 Adapter 的 `defineEval` 创建的 `t` 上。

Agent 是另一种 Adapter。Agent 实现 `send(input, ctx) → Turn`，供 `t.send()` 驱动一次会话往返。
原生 Adapter 不要求实现这个 Agent 协议，也不需要构造 `Turn`；它自己的方法仍可命名为 `send`。

## 返回原生操作

下面的 Adapter 连接一个订单应用。`createOrderApp` 属于应用自身。运行器每个 Attempt 调用一次 `create`，传递取消信号，并在结束时执行已登记的 `onCleanup` 回调。

```ts
import { defineAdapter } from "niceeval";
import { createOrderApp } from "./src/order-app.ts";

export const orders = defineAdapter({
  name: "orders",
  create({ signal, onCleanup }) {
    const app = createOrderApp({ signal });
    onCleanup(() => app.close());

    return {
      createOrder: (sku: string, quantity: number) => app.createOrder({ sku, quantity }),
      cancelOrder: (orderId: string) => app.cancelOrder(orderId),
      findOrder: (orderId: string) => app.findOrder(orderId),
    };
  },
});
```

实例隔离由 Adapter 作者的 factory 实现；运行器不保证返回独立实例，也不会释放未登记 `onCleanup` 的资源。取得资源后立刻调用 `onCleanup`，并把 `signal` 传给网络请求与长任务，取消时应用才能停止工作。返回值必须是普通对象；已有 class 或 client 用闭包包成所需的方法，不直接返回实例。

方法名和参数由应用决定。`check`、`judge`、`signal` 等 NiceEval 名称已由 eval runtime 使用，不能作为返回对象的键。

## 用 Adapter 绑定 eval 与 Match

从同一个 Adapter 值调用 `defineEval`。`t` 同时拥有 Adapter 返回的原生方法和 NiceEval 的断言 API，TypeScript 会从 `create` 的返回对象推导这些方法的参数与结果。

```ts
import { defineValueMatch } from "niceeval/expect";
import { orders } from "../orders.ts";

type Order = {
  readonly id: string;
  readonly status: "pending" | "confirmed" | "cancelled";
  readonly sku: string;
  readonly quantity: number;
};

const isConfirmed = defineValueMatch<Order>({
  name: "订单已确认",
  evaluate: (order) => order.status === "confirmed" && order.quantity > 0,
});

export default orders.defineEval({
  description: "创建的订单可以确认",
  async test(t) {
    const order = await t.createOrder("starter-plan", 1);
    t.check(order, isConfirmed).gate().label("订单确认");
  },
});
```

`defineValueMatch` 只描述怎样比较一个值。`t.check` 才登记 Assertion；`.gate()` 明确把这个 Boolean 条件作为质量门。通过制 eval 的 Boolean 条件默认也参与 Verdict，显式 gate 让评估意图在代码中可见。

Adapter 的 `defineEval` 只接受同一 Adapter 的实现。要让一组实现共用 eval，使用 `defineAdapterContract` 建立共同的原生方法形状，再从该契约调用 `defineEval`。

## 何时使用 Agent

被测对象的主要操作是发送消息、续接会话或处理人工回答时，使用 `defineAgent` 或 `defineSandboxAgent`：

```text
t.send(input) → agent.send(input, ctx) → Turn
```

`Turn` 提供那一轮的状态、事件、数据与 usage，后续断言读取这些会话事实。普通 Adapter 的 `t.createOrder()`、`t.cancelOrder()` 等操作直接返回应用值；用 `t.check` 检查它们即可。不要为原生操作编造消息、事件或 `Turn`，也不要在 core 中按应用领域或协议分支。

## 声明复用边界

执行身份同时包含 Adapter identity（`name`、`contract`、`behaviorRevision`）与 experiment 的 `flags`。Eval 的静态项目内相对 import/export 闭包变化会自动使候选失效。

Experiment 单独选择的实现、动态 import、外部包和远端服务不在这个自动范围内。为这些行为声明非空 `behaviorRevision`，或通过显式配置表达变化；未声明版本的自定义 Adapter 不会自动复用。

## 下一步

- 需要比较多个原生实现：[自定义应用教程](../../../../apps/docs-site/zh/tutorials/custom-application.mdx)
- 被测对象是服务或 SDK endpoint：[Direct Agent](direct-agent.md)
- 被测对象是隔离 Sandbox 中的 CLI：[Sandbox Agent](sandbox-agent.md)
- 需要连续 measurement 或 Judge：[Assertions](../../assertions/README.md)
