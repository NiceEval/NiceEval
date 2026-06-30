import { defineEval } from "fasteval";
import { includes, excludes } from "fasteval/expect";

// 评测任务：给 Express 路由添加请求体校验。
//
// 没有 zod skill 的 agent 通常会：手写 if/typeof 类型守卫、直接信任 req.body、
// 或用 JSON.parse + try/catch。有 skill 的 agent 会知道用 z.object().safeParse()
// 并在校验失败时返回 422 + ZodError.issues。
export default defineEval({
  description: "用 Zod 校验 POST /users 的请求体，失败时返回结构化错误",
  workspace: "./workspaces/ts-starter",

  async test(t) {
    await t
      .send(
        `在 src/routes/users.ts 里实现 POST /users 路由。
要求：
- 用 Zod 定义 CreateUserSchema：{ name: string（非空）, email: string（合法邮箱）, age: number（正整数）}
- 用 .safeParse() 校验 req.body（不要用 .parse()）
- 校验失败 → 返回 HTTP 422，body 为 { errors: result.error.issues }
- 校验成功 → 返回 HTTP 201，body 为 { id: "<uuid>", ...result.data }
- 导出：router（Express.Router）`,
      )
      .then((turn) => turn.expectOk());

    const src = await t.sandbox.readSourceFiles({ extensions: ["ts"] });
    const route = src.fileMatching(/users/);

    await t.group("定义了 Zod schema", () => {
      t.check(route?.content ?? "", includes(/z\.object\s*\(/));
      t.check(route?.content ?? "", includes(/z\.string\s*\(\s*\)/));
      t.check(route?.content ?? "", includes(/z\.number\s*\(\s*\)/));
    });

    await t.group("使用 .safeParse() 而非 .parse()", () => {
      t.check(route?.content ?? "", includes(/\.safeParse\s*\(/));
      // .parse() 在路由里抛异常，是反模式
      t.check(route?.content ?? "", excludes(/\bSchema\.parse\s*\(|Schema\b.*\.parse\(/));
    });

    await t.group("校验失败返回 422 + issues", () => {
      t.check(route?.content ?? "", includes(/422|UNPROCESSABLE/));
      t.check(route?.content ?? "", includes(/\.issues|result\.error/));
    });

    await t.group("不用手写类型守卫或 JSON.parse", () => {
      t.check(route?.content ?? "", excludes(/JSON\.parse/));
      t.check(route?.content ?? "", excludes(/typeof\s+req\.body/));
    });

    t.fileChanged("src/routes/users.ts");

    t.judge
      .score(
        "代码是否正确使用了 Zod 的惯用校验模式？" +
          ".safeParse() 使用是否正确？422 错误响应是否包含 issues？类型是否通过 z.infer<> 派生？",
      )
      .atLeast(0.75);
  },
});
