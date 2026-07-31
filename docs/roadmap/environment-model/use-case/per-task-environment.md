# 每题自带环境

## 解决什么问题

terminal-bench 形态:每题自带 Compose,环境是题意的一部分,agent 是装进去的轻层。
这半边契约不变;变化在叙述上——agent CLI 的现场安装就是 adapter 自动贡献的那个层,排在 experiment 层之后、层栈末位,与 experiment 层同协议(顺序理由见 [README · 生命周期位置](../README.md#生命周期位置))。

## 全流程

```typescript
// evals/terminal-bench/debug-long-program/eval.ts
const environment = composeSandbox({
  file: new URL("docker-compose.yaml", import.meta.url),
  mainService: "client",
  build: "on-demand",
});

export default defineEval({
  environment,                     // 底座:题自己的 Compose,按需构建
  async test(t) {
    await t.send("修好 /app/solver 里的死循环。");
    await t.sandbox.uploadDirectory("./tests", ".tbench-testing");   // 判分材料收工后再挂
    const verify = await t.sandbox.runShell("bash .tbench-testing/run-tests.sh");
    t.check(verify, commandSucceeded());
  },
});
```

```typescript
// experiments/claude-docker.ts
export default defineExperiment({
  agent: claudeCodeAgent(),        // adapter 贡献 agent 层:任务镜像里检查→staged 安装→复检
  sandbox: dockerSandbox({
    materializers: { compose: dockerComposeMaterializer() },
  }),
});
```

## 得到什么

experiment 不知道任何一道题长什么样;换 provider、换 agent 都不碰 241 份题目声明。
