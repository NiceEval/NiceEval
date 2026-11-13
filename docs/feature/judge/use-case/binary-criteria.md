# 用是或否的判据给回复打分

## 用户目标

评估作者有几条只能回答“满足”或“不满足”的要求，例如回复有没有说出实际接入的入口。
他想让每条要求各自得分或失分，不想为每条要求手写两档 `anchors`，也不想看到 `0.6` 这种说不清的中间值。

## 起始状态

项目已配置 `judgeProvider`，已有一条向 Agent 发送请求并拿到回复的 Eval。
本篇是预期用法，输出均为预期结果。

## 过程

1. 作者把每条要求写成一个 `binaryJudge`。评分标准只写什么情况下判为满足：

   ```ts
   import { defineEval } from "niceeval";
   import { binaryJudge } from "niceeval/expect";

   const namesEntry = binaryJudge({
     name: "names-entry",
     rubric: "满足当且仅当回复写出了实际接入的入口路径，并且与 verified.entry 一致。",
   });

   export default defineEval({
     judge: "judge-model",
     async test(t) {
       const turn = await t.send("把这个服务接入评估，并告诉我你接的是哪个入口。");
       const verified = { entry: "/ws/research" };

       t.judge({ reply: turn.reply, verified }, namesEntry)
         .score(2)
         .label("说出接入的入口");
     },
   });
   ```

2. 必须满足的要求改用 `.gate(1)`，不满足时这次运行直接 `failed`：

   ```ts
   t.judge({ reply: turn.reply }, noFabricatedResult)
     .gate(1)
     .label("没有编造运行结果");
   ```

3. 作者运行 Experiment 后查看这次运行的判据：

   ```sh
   niceeval show @1FH9Y2RVQFPWN --assertions
   ```

   ```text
   Assertions @1FH9Y2RVQFPWN
     Verdict passed · Score 0/2
     Gates 1 pass · Scored 1
     GATE pass   没有编造运行结果
     SCORE 0/2   说出接入的入口

     Rationale  回复只说推荐接入 research WebSocket，没有写出入口路径。
   ```

4. Judge 服务不可用时，这条判据显示为 `SCORE ?/2`，分数显示为不完整。它不会被记成 `0`。

## 结果

每条要求只有两种得分：`0` 或满分。理由写明判为不满足的依据，作者可以据此改题或改被测应用。
Judge 没有给出合法回答时结果是不可用，不是失分，所以一次网络故障不会拉低分数。

## 边界

- `binaryJudge` 不接受 `anchors`。需要分档评分时用 `defineJudge`。
- 结果只有 `0` 与 `1`，质量门写 `.gate(1)`。它使用普通的 measurement handle，没有不带参数的默认门槛。
- 代码能核对的事实用精确判据核对，不交给 Judge（[T-27](../../../taste.md#t-27)）。
