import { defineEval } from "fasteval";
import { includes, excludes } from "fasteval/expect";

// 评测任务:用 Effect 做函数式错误处理,不使用 try/catch。
//
// 没有 effect-ts skill 的 agent 几乎一定会写 try/catch 或 Promise.catch 风格的代码;
// 有 skill 的 agent 会知道用 Effect.tryPromise / Effect.catchTag / pipe 等 API。
export default defineEval({
  description: "用 Effect 替代 try/catch 实现可恢复的 HTTP 请求",

  async test(t) {
    await t
      .send(
        `在 src/lib/fetchUser.ts 里实现 fetchUser(id: number)。
要求：
- 用 Effect.tryPromise 包裹 fetch 调用（不要写 try/catch）
- 定义两个自定义错误类：NetworkError 和 NotFoundError（用 class ... extends ... { readonly _tag = "..." }）
- 404 → NotFoundError，网络失败 → NetworkError
- 返回类型：Effect.Effect<User, NetworkError | NotFoundError>
- 所有错误处理通过 Effect.catchTag / Effect.mapError 完成`,
      )
      .then((turn) => turn.expectOk());

    const src = await t.sandbox.readSourceFiles({ extensions: ["ts"] });

    await t.group("使用了 Effect.tryPromise（无 try/catch）", () => {
      t.check(src.text(), includes(/Effect\.tryPromise/));
      // skill 应能让 agent 避免 try/catch
      t.check(src.text(), excludes(/try\s*\{/));
    });

    await t.group("定义了标记联合错误类型", () => {
      t.check(src.text(), includes(/_tag\s*=\s*["']NetworkError["']/));
      t.check(src.text(), includes(/_tag\s*=\s*["']NotFoundError["']/));
    });

    await t.group("用 Effect API 做错误映射", () => {
      const hasEffectErrorHandling = src.text().match(/Effect\.(catchTag|mapError|catchAll)/);
      t.check(hasEffectErrorHandling, includes(/.+/));
    });

    t.fileChanged("src/lib/fetchUser.ts");

    t.judge
      .score(
        "代码是否地道地使用了 Effect-TS 的错误处理模式？" +
          "错误类型定义是否正确？是否避免了命令式 try/catch？",
      )
      .atLeast(0.75);
  },
});
