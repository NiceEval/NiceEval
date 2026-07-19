// 会话 + usage(适配器契约页 Eval 闭环表「会话」与「usage」两行,合并成一个 Eval——
// 同一个协议机制的两个可观察面,分开成两条 Eval 是维护负担不是更多覆盖):claude-code
// 的第二个 t.send() 在同一条会话线内会带上 ctx.session.id,adapter 据此传
// `--resume <id>`(见 src/agents/claude-code.ts 的 send()),第二轮因此能引用第一轮
// 只在对话里说过、从未落盘的事实——这就是"原生 resume ID 续接"成立的证据。
// t.maxTokens() 顺带断言 usage 非空并聚合进 attempt:claude-code CLI 单轮自带巨大的
// 系统提示词与工具定义,单轮 usage(含 cache read)实测在 24k~90k 区间浮动——resume 轮
// 因为要重新读入前一轮的会话上下文,cache read 量本身就会显著跳动,不是异常。200k 的
// 上限只用来兜底"usage 通道整个坏掉"(会拿到异常巨大或需要判定 unavailable 的值),
// 不是在卡真实 token 成本;若 usage 通道被判定不完整(unavailable),整个 attempt 会
// errored 而不是静默通过。

import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "session resume: native --resume carries first-turn facts forward; usage is non-empty per turn",
  async test(t) {
    const first = await t.send(
      "My name is Ada. Please remember it. Do not run any commands or read any files, just acknowledge in one short sentence.",
    );
    first.expectOk();
    first.maxTokens(200_000);

    const recall = await t.send("What is my name? Answer with just the name, do not run any commands.");
    recall.expectOk();
    t.check(recall.message, includes("Ada"));
    recall.maxTokens(200_000);
  },
});
