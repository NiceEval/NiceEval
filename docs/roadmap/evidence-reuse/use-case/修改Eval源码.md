# 修改 Eval 源码

## 冲突场景

Eval 文件与静态源码闭包按整份内容进入 source manifest。
下面四种改动在系统眼里都是 path 上的 digest delta，但语义不同：

1. 给测试代码加一句只供作者阅读的注释。
2. 格式化文件、调整 import 顺序或变量名。
3. 修改会拼进 prompt 的注释文本。
4. 修改断言 helper 或 fixture 生成逻辑。

框架不能可靠区分前两种和后两种。
剥注释或 AST 归一化会把“哪些源码不算语义”变成长期猜测，猜错时会静默沿用无效 Evidence。

## 两套默认

两套政策对已观察到的 source delta 都默认重跑受影响 Eval：

```text
reason source:evals/share/prompts.ts
  affects 30 eval
  change modify 80d1… → b91a…
  default dispatch
```

默认严松的分歧不发生在这里，因为系统已经明确观察到输入变化。
分歧发生在动态 import、项目外依赖等无法形成完整 source manifest 的地方：

- 证明优先：相关 Requirement 为 opaque，默认重跑。
- 复用优先：默认沿用并标 unverified。

## 用户怎样授权不重跑

确认当前 delta 只是注释或格式变化后，可以接受当前计划中的精确原因：

```bash
niceeval exp compare/codex \
  --accept source:evals/share/prompts.ts
```

授权记录 old digest、new digest、受影响 Eval、slot 与 `planKey`。
下一次文件再次变化会产生新 delta，不自动沿用这次授权。

只想对部分 Eval 接受时，先用位置参数收窄：

```bash
niceeval exp compare/codex memory/recall \
  --accept source:evals/share/prompts.ts
```

其它依赖同一文件的 Eval 仍按默认政策重跑。

## 不能安全接受的组合

同时改了注释和断言 helper，只接受注释文件不会放行剩余 delta：

```text
accepted source:evals/share/prompts.ts
remaining source:evals/share/assert-memory.ts
decision dispatch
```

文件重命名表示 delete + add，必须同时接受两个 source reason。
授权类型用判别联合表达缺少一侧 digest，不能用两个必选 string 假装 delete/add 是 modify。

长期频繁变化的文件应按变化频率拆分，减少受影响 Eval 数量。
但不提供永久 `ignoredSources`；路径未来可能从纯注释文件变成题面输入。
