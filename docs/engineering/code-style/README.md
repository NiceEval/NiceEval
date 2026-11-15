# 源码格式与静态检查

## 面向谁

维护这个仓库的人与 coding agent。
目标是让代码 review 只讨论行为：格式由工具决定，未使用的 import、变量和参数由编译器拦下，不靠 reviewer 逐行指出。

## 快速开始

```sh
pnpm format          # 按仓库规则改写格式
pnpm lint            # 其中包含格式检查，格式不符时失败并列出文件
pnpm typecheck       # 未使用的局部变量、参数与 import 报错
```

提交前运行 `pnpm format`，`pnpm lint` 通过即表示格式符合规则。

## 规则

### 格式

- 格式化工具是 Biome，配置在仓库根 `biome.json`，覆盖 `packages/*/src`、`packages/*/scripts`、`e2e` 与 `apps` 下的 TypeScript 与 JavaScript。生成文件、`dist`、fixture 原样数据与锁文件不在范围内。
- 行宽 120，缩进两个空格，字符串使用双引号，语句以分号结尾，多行结构保留尾逗号。
- 行宽是格式化工具的目标，不是硬上限：字符串、URL 与正则字面量不会被折断。决定行为的长文本（Judge 与模拟用户的 prompt）放进独立的 `.prompt.ts` 模块，由句子片段显式拼接，不写成一行长字符串。
- 一行只写一条语句；需要说明的中间值拆成具名局部变量，不靠机械折行。
- `pnpm lint` 运行 `biome format` 的检查模式，不改写文件。

### 静态检查

- 各包的 `tsconfig.json` 打开 `noUnusedLocals` 与 `noUnusedParameters`。故意不用的参数以 `_` 开头。
- 不另加 lint 规则集：类型系统与 Concord 已覆盖的检查不重复；以后要加规则，先说明它拦下的是哪一类真实缺陷。

### 可选属性

`niceeval` 包打开 `exactOptionalPropertyTypes`。
这个开关区分可选属性的两种含义：值可以未提供，或者键不得出现。
只有键是否存在会被观察时，两者才有行为差异；规则按这条边界写类型，不在调用点逐个迁就编译器。

键的存在会被观察的边界只有这几类：

1. Record JSON：`RecordJson` 不含 `undefined`，canonicalizer 遇到 `undefined` 拒绝写入，`Schema.optionalKey` 编码同样拒绝。
2. 身份与摘要材料：自写的 canonical 序列化（例如 Judge material）按键枚举，`undefined` 会改变结果或直接失败。
3. 合并补丁：以 `{ ...base, ...patch }` 覆盖默认值的对象，`patch.x = undefined` 会抹掉默认值。
4. 按键枚举有语义的对象：`Object.keys`、`Object.entries`、`in` 或 `Object.hasOwn` 的结果参与行为或输出。
5. 第三方声明为精确可选的类型。

类型按下面的规则写：

- 默认写 `readonly x?: T | undefined`。
  公开 API 的输入与输出、Agent 与 Sandbox 的上下文、选项包、`Turn`、`Usage` 等领域值、测试辅助都属于默认情况。
  生产者直接写 `{ model: ctx.model }`；消费者用 `!== undefined` 或 `??` 判断，不用 `in`。
- 只有落在上述边界上的自有类型写精确的 `x?: T`，并在类型声明旁用一句注释写明属于哪类边界。
- 宽值进入精确类型只在边界上转换一次：优先用该边界已有的 Schema 编码或构造函数；字段多于两个时用 `shared/omit-undefined.ts` 的 `omitUndefined`；一两个字段可以写条件展开。
  流水线中段的函数参数与返回值不做这种转换。
- 可变状态里表示暂时没有值的字段写成必需键 `x: T | undefined`，清空时赋 `undefined`，不用 `delete`。
- 不用非空断言 `!` 或 `as` 绕过可选属性检查。
- 手写类型与对应 Schema 保持一致：`Schema.optional` 对应 `?: T | undefined`，`Schema.optionalKey` 只用于上述边界。

放宽类型不改变身份：基于 `JSON.stringify` 的摘要本来就省略值为 `undefined` 的键；按键枚举的 canonical 材料属于第 2 类边界，保持精确类型。
放宽公开类型会改变生成的参考页，改完从仓库根运行 `pnpm run repo docs reference`。

### 格式化与身份

NiceEval 的运行时身份由实际提示、工具 Schema 与必要的能力行为计数构成，不直接使用其源码排版。
单纯格式化 NiceEval 源码不改变这些输入；整理时须核对字符串、对象顺序及行为计数保持不变。
Judge 与模拟用户的 prompt 字节会影响行为，格式化不改变字符串字面量的内容；改写 prompt 内容按[身份域规则](../../feature/experiments/architecture/cache.md#niceeval-身份域变更)处理。

### 首次接入

接入 Biome 时，用一个只含格式变化的提交格式化全部范围，提交说明写明它不含行为变化。
这个提交在没有其它进行中改动时完成，避免与并行工作冲突；之后的格式问题由 `pnpm lint` 在每次提交前拦下。
打开 `noUnusedLocals` 与 `noUnusedParameters` 时，同一提交删除编译器报出的全部未使用项。

## 验收

- `pnpm format` 之后 `git diff` 为空时，`pnpm lint` 的格式检查通过；手动改乱一个文件的缩进，`pnpm lint` 失败并列出该文件。
- 在任一源码文件留下未使用的 import，`pnpm typecheck` 失败并指出位置。
- 默认情况下的自有类型可选属性都写成 `?: T | undefined`；条件展开 `x === undefined ? {} : { x }` 只出现在上述边界的转换处；状态字段不用 `delete` 清空。
- 首次格式化提交前后，`pnpm test`、`pnpm run build:package` 结果相同；固定消费样例的身份摘要不变。
- Judge 与模拟用户 prompt 的 UTF-8 字节在格式化前后相同。
