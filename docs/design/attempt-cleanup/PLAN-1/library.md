# Library：资源实现声明排空预算

```ts
export type AttemptCancellation =
  | { readonly kind: "timeout"; readonly timeoutMs: number;
      readonly source: "flag" | "experiment" | "eval" | "config";
      readonly deadlineAt: number }
  | { readonly kind: "cancelled" };

export interface AttemptSignal extends AbortSignal {
  readonly reason: AttemptCancellation | undefined;
}

// defineAdapter(input) 与 AdapterContract.implement(input) 的实现选项
interface CleanupOptions {
  readonly cleanupTimeoutMs?: number;
}

interface AdapterCreateContext {
  readonly signal: AttemptSignal;
  onCleanup(callback: (ctx: AdapterCleanupContext) => void | Promise<void>): void;
}
interface AdapterCleanupContext {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly deadlineAt: number;
}
```

类型从 niceeval 根与 niceeval/adapter 导出。AttemptSignal 仅由运行时控制，不公开构造器。
未取消的 reason 为 undefined；timeout 与 cancelled 都为冻结值。外部任意 reason 不用于推断 timeout。
source 与现有执行 timeout 配置优先级完全一致。deadlineAt 为 Unix 毫秒，仅供传播期限；运行时计时仍由 Effect 拥有。

cleanupTimeoutMs 由资源实现声明，默认 30000，允许整数 1 至 300000 ms。
undefined 使用默认；NaN、Infinity、零、负数、小数及越界值定义时抛 TypeError。
不在 Contract、Eval、Experiment、Config 或 CLI 再加配置替换层；具体连接器知道排空协议，创建前即固定预算。
使用者可由自己的 Adapter 工厂参数选择预算，然后传给 defineAdapter。

```ts
const application = defineAdapter({
  name: "continuous-application",
  cleanupTimeoutMs: 95_000,
  create(ctx) {
    ctx.onCleanup(async ({ signal, deadlineAt }) => {
      await connection.stopAndDrain({ signal, deadlineAt });
      await archiveSettledRequests();
    });
    // 原生方法由应用定义。
    return applicationMethods;
  },
});
```

此选项仅控制该自定义 Adapter 的资源释放时段，不增加 Agent teardown 或 Sandbox stop 的时限。
Agent 和游戏属于同层应用；本次修正不重新定义 Agent 生命周期。
