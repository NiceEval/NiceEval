# 用原生操作评估订单应用

## 用户目标

应用作者要检查创建订单的结果，直接调用业务方法，不把订单操作包装成 Agent 对话。

## 起始状态

项目已配置 NiceEval 的 Eval 与 Experiment 发现目录。
应用的 `src/order-app.ts` 导出 `createOrderApp({ signal })`，返回支持 `createOrder` 与 `close` 的订单客户端。
以下是接入示例，所有观察结果均为预期输出，未实际调用订单服务。

## 完整路径

1. 在 `orders.ts` 中用 `defineAdapter` 暴露订单方法，并登记连接释放回调。 {#connect}

   ```ts
   import { defineAdapter } from "niceeval";
   import { createOrderApp } from "./src/order-app.ts";

   export const orders = defineAdapter({
     name: "orders",
     create({ signal, onCleanup }) {
       const app = createOrderApp({ signal });
       onCleanup(() => app.close());
       return {
         createOrder: (sku: string, quantity: number) =>
           app.createOrder({ sku, quantity }),
       };
     },
   });
   ```

   预期输出：得到可用于定义 Eval 和选择被测实现的 `orders`；模块加载本身不创建订单连接。

2. 在项目的 Eval 目录中保存 `confirm-order.ts`，从同一个 Adapter 定义评估。 {#evaluate}

   ```ts
   import { equals } from "niceeval/expect";
   import { orders } from "../orders.ts";

   export default orders.defineEval({
     description: "创建的订单已确认",
     async test(t) {
       const order = await t.createOrder("starter-plan", 1);
       t.check(order.status, equals("confirmed"))
         .gate()
         .label("订单确认");
     },
   });
   ```

   预期输出：`t.createOrder` 的参数与返回类型来自订单客户端；断言检查真实返回的 `status`。

3. 在项目的 Experiment 目录中保存 `orders.ts`，选择同一个 Adapter，执行该评估。 {#run}

   ```ts
   import { defineExperiment } from "niceeval";
   import { orders } from "../orders.ts";

   export default defineExperiment({
     adapter: orders,
     attempts: 1,
   });
   ```

   ```sh
   niceeval exp orders confirm-order
   ```

   预期输出：订单服务返回 `confirmed` 时，检查匹配且 Attempt 为 `passed`；其它状态使质量门不满足，Attempt 为 `failed`。
   Attempt 结束时执行已登记的 `app.close()`。

## 结果

作者用业务调用取得订单，再用通用断言评估返回值。
应用连接随 Attempt 创建和释放；此路径不需要 `send`、Session 或 `Turn`。

## 相关契约

- [编写自定义 Adapter](../library/writing-an-adapter.md)：原生方法、绑定 Eval 与资源释放。
- [Adapter Library](../library/README.md#attempt-取消与资源释放预算)：取消与 cleanup 边界。
- [Experiment 选择 Adapter](../../experiments/library/README.md#选择-adapter) 与 [CLI](../../experiments/cli/README.md#命令)：选择实现并运行。
- [Assertions Library](../../assertions/library/README.md)：值检查与质量门。
