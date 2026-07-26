# 参考页手写漂移:接入源码生成区块 + 漂移守护

## 现象

docs-site/zh/reference/ 的 8 个参考页(2026-07-08 逐页审计)大面积漂移,三页接近失真:

- expect.mdx:`matches()` 被写成正则匹配(实为 Standard Schema/zod 校验,照示例写恒 0 分);虚构了不存在的 `.soft()` 方法;`makeAssertion` 签名整个错(写成二段调用工厂);`similarity` 被说成"语义相似度"(实为纯 Levenshtein);漏 5 个 matcher。
- events.mdx:三处引用早已删除的 `compactionObservability`/`toolObservability` 声明字段,与 capabilities.mdx"声明层已拿掉"同站互相矛盾(send 契约收缩重构的漏网之鱼)。
- cli.mdx / define-eval.mdx:`--timeout-ms`(实为 `--timeout`)、`init` 声称生成示例文件(实际不生成)、`t.newSession()` 写成返回 void(实为 SessionHandle)、TurnHandle 20+ 断言方法只列一小半、10 个 flag 与全部 `NICEEVAL_*` env 缺失。
- 横向:config `telemetry` 被三页引用但 define-config 参考页本身没这个字段。

## 根因

参考页纯手写,与源码之间没有任何机器守护;API 演进(能力声明层移除、flag 改名)后没人回来同步,页与页之间还互相引用对方没有的内容。

## 修法

用户明确批准生成中间层后落地(commit 见 git log 2026-07-08):

- 源码 TSDoc(中文)是唯一事实来源;7 个 `src/*/types.ts` + `src/expect/index.ts` 补齐了公开面注释。
- `scripts/generate-reference.ts`(TS compiler API,零新依赖)把接口成员/字段/CLI flag 表生成进参考页的 `{/* GENERATED:BEGIN <id> */}` 区块,`pnpm docs:reference` 重写区块、区块外手写叙事不动。CLI flag 从 `src/cli.ts` 的 FLAG_OPTIONS 静态 AST 提取(不 import,有模块级副作用);flag 描述在生成器内 FLAG_DESCRIPTIONS 表,新 flag 缺描述会硬报错。
- `test/docs-site/reference-consistency.test.ts` 随 `pnpm test:docs-site` 做漂移守护:内存重生成与已提交文件逐字节比对,改了源码忘跑生成命令会红。
- **区块内内容永远不要手改**,改注释后跑 `pnpm docs:reference`。
- 顺带清掉 `EvalDef.agent` 死字段(runner 全链路零消费,agent 由 experiment 决定)。

适用场景:凡"文档描述机器可导出的事实"(签名、字段、flag、事件形状)都应走生成区块;纯叙事(能力判决、映射纪律、鉴权方式)保持手写,靠审计和交叉引用检查。
