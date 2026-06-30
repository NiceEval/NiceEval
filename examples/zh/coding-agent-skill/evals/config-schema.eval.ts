import { defineEval } from "fasteval";
import { includes, excludes } from "fasteval/expect";

// 评测任务：用 Zod 解析并验证环境变量。
//
// 没有 zod skill 的 agent 通常会用 process.env.X ?? "default" 直接读取，
// 缺乏类型安全和格式校验。有 skill 的 agent 会定义 EnvSchema、用 .parse()
// 一次性验证所有变量，并通过 z.infer<> 获得正确类型。
export default defineEval({
  description: "用 Zod 定义 EnvSchema 解析环境变量，类型安全地导出 env 对象",
  workspace: "./workspaces/ts-starter",

  async test(t) {
    await t
      .send(
        `在 src/config/env.ts 里实现环境变量校验。
要求：
- 用 Zod 定义 EnvSchema，包含以下字段：
  - PORT: 数字字符串，转换为 number（用 .transform(Number) 或 z.coerce.number()）
  - DATABASE_URL: 合法 URL 字符串
  - NODE_ENV: 枚举值 "development" | "production" | "test"，默认 "development"
  - JWT_SECRET: 字符串，最少 32 个字符
- 用 EnvSchema.parse(process.env) 验证并导出 env 对象
- 用 z.infer<typeof EnvSchema> 导出 Env 类型
- 验证失败时直接让 .parse() 抛出（应用启动时快速失败是正确行为）`,
      )
      .then((turn) => turn.expectOk());

    const src = await t.sandbox.readSourceFiles({ extensions: ["ts"] });
    const config = src.fileMatching(/env/);

    await t.group("用 z.object() 定义 EnvSchema", () => {
      t.check(config?.content ?? "", includes(/z\.object\s*\(/));
      t.check(config?.content ?? "", includes(/EnvSchema/));
    });

    await t.group("覆盖了必要字段", () => {
      t.check(config?.content ?? "", includes(/DATABASE_URL/));
      t.check(config?.content ?? "", includes(/NODE_ENV/));
      t.check(config?.content ?? "", includes(/JWT_SECRET/));
    });

    await t.group("PORT 做了数字转换", () => {
      // z.coerce.number() 或 .transform(Number) 都是正确写法
      const hasCoerce = /z\.coerce\.number/.test(config?.content ?? "");
      const hasTransform = /transform\s*\(\s*Number/.test(config?.content ?? "");
      t.check(hasCoerce || hasTransform, includes(/true/));
    });

    await t.group("导出 env 对象（parse，不是 safeParse）", () => {
      // 启动时直接 parse 是正确的——失败就崩，明确快速
      t.check(config?.content ?? "", includes(/EnvSchema\.parse\s*\(\s*process\.env/));
      t.check(config?.content ?? "", includes(/export.*\benv\b/));
    });

    await t.group("不用裸 process.env 字段读取", () => {
      // 不应该出现 process.env.PORT ?? ... 这类手动读取
      t.check(config?.content ?? "", excludes(/process\.env\.\w+\s*\?\?/));
    });

    t.fileChanged("src/config/env.ts");

    t.judge
      .score(
        "是否正确使用了 Zod 解析环境变量？PORT 的类型转换是否到位？" +
          "NODE_ENV 是否用 z.enum() 并有默认值？JWT_SECRET 是否有长度约束？",
      )
      .atLeast(0.75);
  },
});
