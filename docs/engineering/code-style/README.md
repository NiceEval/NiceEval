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
目标是减少 `undefined`，让类型约束生产者：一个值越晚出现「可能没有」，下游越少分支。
可选属性只留给外部作者省略字段的场景；内部值在入口归一化后不再有可选属性。

按值由谁构造，类型分三层：

1. **外部输入**：由用户、adapter 作者或第三方构造的值，例如 config 与 experiment 选项、`defineAgent` 选项、`Turn`、`Usage`、`CommandOptions`、`AgentContext`。
   可选属性写 `readonly x?: T | undefined`，同时接受省略与 `undefined`。
   这些值在进入 NiceEval 的第一个函数里归一化一次，之后流转的是第 2 层的内部类型。
2. **内部值**：只由 NiceEval 自己构造的值，包括归一化后的配置与上下文、NiceEval 传给用户回调的参数、函数返回值、可变状态与中间结果。
   这些类型不写可选属性。把可选属性改写成 `x: T | undefined` 并没有减少 `undefined`，只是换了写法；按下面的顺序消掉它，前一种做得到就不用后一种：
   1. 删掉字段：没有消费者读取，或者调用方可以自己算出来。
   2. 入口补齐：有默认值的字段在归一化时补上，字段必需且不含 `undefined`，下游不再用 `??` 重复补默认值。
      函数类型的属性同样如此：在构造处给出实现或默认实现，不写 `((…) => R) | undefined`。
   3. 判别联合：几个字段同时出现或同时缺席、或者某个字段只在某种状态下有意义时，合成一个带标签的联合。
      例如 `{ reuseEligibility: "dynamic-module-unresolved" | undefined; reuseEligibilityFacts: Facts | undefined }` 应写成 `{ kind: "eligible" } | { kind: "dynamic-module-unresolved"; facts: Facts }`。
   4. 必需键 `readonly x: T | undefined`：只留给与其它字段无关、且事实本身可能不存在的单个值，例如实验没有指定 `model`、协议没有上报某个 token 桶；生产者必须显式给出每个字段，漏写由编译器拦下。
   - 可变状态清空时赋 `undefined`，不用 `delete`。
3. **键存在会被观察的边界**：键是否出现会改变行为或输出的地方，类型写精确的 `x?: T`，并在声明旁用一句注释写明属于下面哪一类：
   - Record JSON：`RecordJson` 不含 `undefined`，canonicalizer 与 `Schema.optionalKey` 编码遇到 `undefined` 拒绝写入；
   - 身份与摘要材料：自写的 canonical 序列化按键枚举，`undefined` 会改变结果或直接失败；
   - 合并补丁：以 `{ ...base, ...patch }` 覆盖默认值的对象，`patch.x = undefined` 会抹掉默认值；
   - 按键枚举有语义的对象：`Object.keys`、`Object.entries`、`in` 或 `Object.hasOwn` 的结果参与行为或输出；
   - 第三方声明为精确可选的类型。

转换只在层与层之间发生一次：

- 外部输入到内部值，由入口的归一化函数补齐默认值、产出判别联合或显式写出 `undefined`。
- 内部值到边界，优先用该边界已有的 Schema 编码或构造函数；字段多于两个时用 `shared/omit-undefined.ts` 的 `omitUndefined`；一两个字段可以写条件展开 `x === undefined ? {} : { x }`。
- 条件展开只出现在进入边界的这一处，不出现在内部值之间的传递里。

`null` 与 `undefined` 只选一个：

- TypeScript 里表示没有值统一写 `undefined`。
- `null` 只出现在外部格式本身的类型里：JSON 与 Record 载荷、SQLite 行、DOM、React 与 `RegExp` 等第三方 API。JSON 与 SQL 写不出 `undefined`，这些类型照外部格式声明。
  外部格式解码成内部值时，`null` 转成 `undefined`；内部值编码成外部格式时再转回去。
- 同一个属性不同时接受 `null` 与 `undefined`，不写 `T | null | undefined`，也不用 `null` 与 `undefined` 各表示一种状态。
  需要区分“未知”与“明确没有”时，用判别联合或具名字面量。

其它约束：

- 不用非空断言 `!` 或 `as` 绕过可选属性检查。
- 内部类型的属性不写 `unknown`。外部抛出值在 catch 边界用 `shared/external-cause.ts` 的 `normalizeExternalCause` 转成 `ExternalCause`；NiceEval 自己的错误写成具体的 tagged error 联合。`unknown` 已包含 `undefined`，把 `x?: unknown` 改成 `x: unknown` 不构成收紧。
- 手写类型与对应 Schema 保持一致：`Schema.optional` 对应 `?: T | undefined`，`Schema.optionalKey` 只用于第 3 层边界。
- 公开类型只在构造方全部位于 NiceEval 内部时才按第 2 层收紧；使用方读到的仍是 `T | undefined`，外部构造方不受影响。

调整类型不改变身份：基于 `JSON.stringify` 的摘要本来就省略值为 `undefined` 的键；按键枚举的 canonical 材料属于第 3 层，保持精确类型。
公开类型变化会改变生成的参考页，改完从仓库根运行 `pnpm run repo docs reference`。

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
- 内部值类型没有可选属性；外部输入类型的可选属性写成 `?: T | undefined`；条件展开 `x === undefined ? {} : { x }` 只出现在进入边界的转换处；状态字段不用 `delete` 清空。
- 首次格式化提交前后，`pnpm test`、`pnpm run build:package` 结果相同；固定消费样例的身份摘要不变。
- Judge 与模拟用户 prompt 的 UTF-8 字节在格式化前后相同。
