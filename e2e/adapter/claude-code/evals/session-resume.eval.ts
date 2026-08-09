// Claude Code 的第二个 t.send() 在同一会话线内传入原生 session id，
// adapter 用 --resume 续接；第二轮能引用未落盘的首轮事实即是真实续轮证据。
import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "会话续接:原生 --resume 把首轮事实带到后续轮，且每轮 usage 可用",
  async test(t) {
    const first = await t.send(
      "我叫 Ada，请记住这个名字。不要运行任何命令，不要读取任何文件，用一句简短的话确认。",
    );
    await first.succeeded().stopOnFailure();
    first.maxTokens(200_000);

    const recall = await t.send("我叫什么名字？只回答名字，不要运行任何命令。");
    await recall.succeeded().stopOnFailure();
    t.check(recall.message, includes("Ada"));
    recall.maxTokens(200_000);
  },
});
