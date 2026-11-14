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
- 首次格式化提交前后，`pnpm test`、`pnpm run build:package` 结果相同；固定消费样例的身份摘要不变。
- Judge 与模拟用户 prompt 的 UTF-8 字节在格式化前后相同。
