# Assertion 作者面类型原型

本目录保存 Roadmap 公开类型的可编译原型，不提供运行时实现。
[`type-prototype.ts`](type-prototype.ts) 使用真实 Standard Schema 类型验证 matcher refinement、domain 组合与 Assertion handle 状态机。

修改 `matching.md` 或 `library.md` 中的公开签名后运行：

```sh
pnpm exec tsc -p docs/roadmap/assertion-authoring/reference/tsconfig.json
```

仓库级 `pnpm typecheck` 已包含这条命令。

原型中的 `@ts-expect-error` 是契约的一部分：对应调用一旦意外通过，TypeScript 会让本命令失败。
