import { defineEval } from "fasteval";
import { includes, excludes } from "fasteval/expect";

// 评测任务:用 Effect Schema 解析一段不可信的 JSON 输入。
//
// 这个任务对「有 effect-ts skill」的 agent 更容易:skill 会注入 @effect/schema 的
// API 用法与最佳实践,让 agent 知道该用 S.Struct / S.decodeUnknown 而不是手写 zod 或
// 手动 JSON.parse + try/catch。
//
// 跑「baseline」实验时,agent 通常会退回到 zod 或手写解析,通不过下面的断言。
export default defineEval({
  description: "用 @effect/schema 解析用户输入的 JSON",

  async test(t) {
    await t
      .send(
        `在 src/lib/parseUser.ts 里实现一个 parseUser 函数。
要求：
- 用 @effect/schema（S.Struct）定义 User schema：{ id: number, name: string, email: string }
- 用 S.decodeUnknown 解析输入的 unknown 值
- 解析失败时返回 Effect.fail 而不是抛异常
- 导出：parseUser(raw: unknown): Effect.Effect<User, ParseError>`,
      )
      .then((turn) => turn.expectOk());

    const src = await t.sandbox.readSourceFiles({ extensions: ["ts"] });
    const parseUser = src.fileMatching(/parseUser/);

    await t.group("使用了 Effect Schema API", () => {
      // skill 应该让 agent 知道用 S.Struct 而不是手写类型
      t.check(parseUser?.content ?? "", includes(/S\.Struct|Schema\.Struct/));
      t.check(parseUser?.content ?? "", includes(/S\.decodeUnknown|Schema\.decodeUnknown/));
    });

    await t.group("返回 Effect 而非抛异常", () => {
      t.check(parseUser?.content ?? "", includes(/Effect\.Effect|Effect<User/));
      t.check(parseUser?.content ?? "", excludes(/throw\s+new|JSON\.parse\(/));
    });

    await t.group("文件存在且有导出", () => {
      t.fileChanged("src/lib/parseUser.ts");
      t.check(parseUser?.content ?? "", includes(/export.*parseUser|export function parseUser/));
    });

    // judge:整体代码质量打分(0–1),不低于 0.7 才算通过
    t.judge
      .score("代码是否正确使用了 @effect/schema 的惯用写法？是否类型安全？错误处理是否到位？")
      .atLeast(0.7);
  },
});
