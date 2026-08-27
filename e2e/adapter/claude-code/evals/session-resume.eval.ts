// Claude Code 的第二个 t.send() 在同一会话线内传入原生 session id，
// adapter 用 --resume 续接；第二轮能引用未落盘的首轮事实即是真实续轮证据。
import { defineEval } from "niceeval";
import { includes, satisfies } from "niceeval/expect";

const firstUserSentinel = "claude-live-user-one-sentinel";
const firstCommandSentinel = "claude-live-command-one-sentinel";
const secondUserSentinel = "claude-live-user-two-sentinel";
const secondCommandSentinel = "claude-live-command-two-sentinel";

export default defineEval({
  description: "会话续接:原生 --resume 把首轮事实带到后续轮，且每轮 usage 可用",
  async test(t) {
    const first = await t.send(
      `${firstUserSentinel}: 我叫 Ada，请记住这个名字。先执行 shell 命令 \"printf '%s\\n' ${firstCommandSentinel}; sleep 10\"，然后用一句简短的话确认。`,
    );
    await first.succeeded().orStop();
    t.check(
      first.usage,
      satisfies<typeof first.usage>(
        "usage within 200000 tokens",
        (usage) =>
          usage !== undefined &&
          (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) <= 200_000,
      ),
    );

    const recall = await t.send(
      `${secondUserSentinel}: 我叫什么名字？先执行 shell 命令 \"printf '%s\\n' ${secondCommandSentinel}; sleep 10\"，最后只回答名字。`,
    );
    await recall.succeeded().orStop();
    t.check(recall.message, includes("Ada"));
    t.check(
      recall.usage,
      satisfies<typeof recall.usage>(
        "usage within 200000 tokens",
        (usage) =>
          usage !== undefined &&
          (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) <= 200_000,
      ),
    );
  },
});
