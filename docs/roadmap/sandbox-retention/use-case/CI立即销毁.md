# CI 立即销毁

CI 批跑不把失败现场默认转成远端 snapshot 或本地 stopped container。
当 `CI` 宿主事实成立且项目没有替换策略时，求值结果是：

```text
SANDBOX RETENTION  retain failed · release destroy · CI default
```

普通命令即可使用这项默认策略：

```bash
niceeval exp ci
```

passed、failed、errored 与 cleanup incomplete 的物理 Sandbox 都执行 destroy。
Attempt Verdict 与 Record 正常保存；没有 registry 条目可 enter。

团队希望把策略显式签入时，可以写：

```ts
// niceeval.config.ts
export default defineConfig({
  sandboxRetention: {
    release: "destroy",
  },
});
```

一次调用也可以指定更高优先级的策略：

```bash
niceeval exp ci --sandbox-release=destroy
```

destroy 失败不是普通 warning。
资源仍可能 active 或 unknown 时，Invocation completion 为 incomplete、命令退出非零，并阻止同 Provider 继续创建资源。

CI 日志必须给出 `retentionId`、Provider 状态和 `niceeval sandbox list`。
ephemeral runner 消失后，managed Provider 的创建期 active failsafe 仍负责停止 compute。
