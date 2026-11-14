# Eval 源码身份忽略注释与排版

## 要决定什么

Eval 源码闭包现在按文件原始字节计算内容哈希。只改注释、缩进或空行，也会让依赖这份源码的结果全部作废，只能付费重跑。
NiceEval-Eval 这类付费评测项目因此不敢整理注释，也不敢格式化 Eval 源码。

本设计决定：源码闭包里的 JavaScript / TypeScript 文件按什么规范化文本计算身份，怎样处理已有结果，以及哪些情况仍按原始字节计算。

非目标：

- 不改变 loader 数据、criteria、private 文件与 transfer manifest 的哈希方式；它们是数据，格式变化可能就是语义变化。
- 不让语义等价的改写（改变量名、调整语句顺序）沿用结果。
- 不改变 Provider、installer 等 owner 声明的身份。

## 现状

- `runner/fingerprint.ts` 的 `sourceClosure` 从 Eval 入口出发，用正则匹配 `import` / `export ... from` 找相对模块。
  指纹载荷保存 `[相对路径, 原始文本]`，manifest 保存文本哈希。
- 这个正则也匹配被注释掉的 import，于是注释里的路径会被拉进闭包；`import()` 动态导入不被识别。
  这与 [Eval 架构](../feature/eval/architecture.md) 写的“静态相对 import 在所属 owner 内递归捕获”不符。
- Agent Judge、普通 Judge 与模拟用户的能力识别用正则扫描同一份原始文本（例如 `/\bagentJudge\s*\(/`），注释里提到这些名字也会触发。
- Eval 输入的身份域是 `fingerprintAlgorithm: 5` 与 `fingerprintCoverage: 3`，变更登记在 `runner/identity-domains.ts`，规则见 [身份域变更](../feature/experiments/architecture/cache.md#niceeval-身份域变更)。

## 方案

### 规范化文本

对扩展名为 `.ts`、`.tsx`、`.mts`、`.cts`、`.js`、`.jsx`、`.mjs`、`.cjs` 的闭包文件，先用解析器取得精确的注释区间与受保护区间，再生成规范化文本：

1. 受保护区间原样保留：字符串字面量、模板字面量的静态片段、正则字面量、JSX 文本、hashbang 与指令（`"use strict"`）。
   JSX 引号属性也按字符串保留。模板的 `${}` 内递归处理表达式，不能把整个模板作为单一区间，也不能改写静态片段的 raw 文本。
2. 编译器指令注释原样保留，包括 JSX 的 `@jsx`、`@jsxFrag`、`@jsxRuntime` 与 `@jsxImportSource`。
   jiti 开启 JSX 时，`/** @jsx h */` 和 `/** @jsx g */` 调用不同函数，不能删除后视为相等。
   指令集合必须按实际装载器确认；不能证明是普通注释的编译指令按原始文本保留。
3. 普通注释区间删除。注释本身跨行时替换为一个换行，否则替换为一个空格。
4. 受保护区间以外的空白连续段：只要包含换行就折叠为一个 `\n`，否则折叠为一个空格；文件首尾空白删除。

换行包括 ECMAScript 的 LF、CR、CRLF、U+2028 与 U+2029，其余空白按同一语言规范识别。
HTML 风格注释按所属模块的 script / module 语法识别，不自行用正则删除。
注释替换产生的空白也参与连续段折叠；受保护区间内的空白始终保留。
所有区间使用统一坐标系；非 ASCII 与非 BMP 字符前后的切片必须验证，不能混用 UTF-8 字节偏移与 UTF-16 索引。

保留“有没有换行”是为了不改变自动分号插入的语义：`return\nvalue` 与 `return value` 的规范化文本不同。
因此不改变换行存在性的缩进、空行和普通注释修改可以沿用。
增删含换行的块注释可能改变自动分号插入，仍须作废。把一行代码拆成两行，或把两行合并成一行，也仍须作废。

身份载荷里每个闭包文件的条目是 `[相对路径, <配方>:<sha256 十六进制>]`：JavaScript / TypeScript 文件用 `n1:` 加规范化文本的哈希，其它文件用 `r1:` 加原始字节的哈希。
manifest 投影使用同一个字符串，载荷不再保存源码原文。规范化文本只用于计算身份，Sources 与断言源码定位仍保存原始字节。
编译指令以外的注释保护集合按 jiti 实际识别的指令确定；不能证明是普通注释的，按原文保留。

### 解析器

解析器提供注释区间、受保护区间与模块依赖，规范化规则由 NiceEval 自己实现，不直接哈希整棵 AST。
身份仍依赖解析器对语法、注释和区间的判定，所以解析器的版本与选项属于 `fingerprintAlgorithm` 配方的一部分。

采用 `oxc-parser`，在 NiceEval 的依赖里固定到精确版本，只使用它的原生 binding：

- 不使用 wasm 或 webcontainer 回退，也不在运行时安装 binding。当前平台没有可用 binding 时，规划以环境错误失败，写明平台与缺少的包。
- binding 装载入口必须在执行包内自动回退逻辑前完成原生目标检查，并验证 binding 与解析器版本一致。环境变量指定的替代 binding 或 WASI 后端不能改变身份配方。
- 语言与模块类型按扩展名决定：`.ts`、`.mts` 为 TypeScript module，`.cts` 为 TypeScript CommonJS，`.tsx` 为 TSX，`.js`、`.mjs` 为 module，`.cjs` 为 CommonJS，`.jsx` 为 JSX。
- 区间按解析器返回的 UTF-16 索引切片，不与 UTF-8 字节偏移混用。

解析器报告任何错误时，规划失败并给出文件、行列与解析器消息，不使用错误恢复得到的 AST，也不退回原始字节。
jiti 能运行而解析器拒绝的语法因此会阻止规划；这比用不完整的闭包或另一种编码计算身份更安全。
错误反馈说明当前语法模式与文件扩展名，并保留固定历史 Run 的读取入口。
升级解析器时，发布校验的固定样例必须证明规范化文本、依赖成员与能力选择全部不变，否则更换 `fingerprintAlgorithm`。

### 闭包成员与能力识别

模块依赖只有一个 owner：发现阶段用解析器为每个模块建立依赖边，形成冻结的模块图。
loader、criteria 与 private 输入的逐 Eval 传播、Eval Group 的 definition hash、源码捕获与指纹都消费这一份模块图。
`runner/source-closure.ts`、`fingerprint.ts` 与 fresh import 里的正则扫描全部删除，不再各自扫描磁盘。
模块图保留依赖边的语法种类与求值时机。身份覆盖保守收集的 `import()`、条件 `require()` 不能成为 fresh import 提前求值的指令；未执行的分支保持不执行。

依赖边按以下规则收集，specifier 使用 AST 解码后的字符串，按 jiti 实际使用的模块解析规则查找：

| 写法 | 是否进入闭包 |
| --- | --- |
| `import ... from`、`import "x"`、`export ... from`、`export * from` | 进入 |
| 整句的 `import type`、`export type` 与 `import type x = require()` | 不进入：编译后不执行目标模块 |
| 同一句里混有值与 `type` 修饰的导入 | 保守进入；jiti 可能擦除未使用的值导入，不能声称目标必定执行 |
| 只含逐项 `type` 修饰的导入或重导出 | 不进入：编译后不执行目标模块 |
| 参数为字符串字面量的 `import()` | 进入，不论这个分支是否执行 |
| 参数为字符串字面量、且 `require` 未被局部遮蔽的 `require()`；TypeScript `import x = require()` | 进入 |
| 未被局部遮蔽的 CommonJS `module.require()`，参数为字符串字面量 | 进入 |
| TypeScript `export = expression` | 遍历表达式中的依赖调用；`export = require("x")` 按 `require()` 规则进入 |
| 参数不是字符串字面量的 `import()` 或 `require()` | 不进入；规划给出 `dynamic-module-unresolved` warning，写明文件与行列 |

查找结果按 realpath 遵守 [Eval 架构](../feature/eval/architecture.md#文件访问边界) 的 owner 边界。
依赖类别按实际查找结果确定，不能只看 specifier 前缀。tsconfig 本地别名及 package imports 映射到 owner 内源码时，进入同一模块图；实际包依赖沿用安装内容摘要规则。

非字面量调用的 warning 不是完整依赖证明。`require` 别名、`createRequire()` 与其它间接加载同样可能执行项目文件，不能无诊断地视为无依赖。
`import.meta.glob` 等 jiti 不支持的扩展语法不属于模块图保证。

Agent Judge、普通 Judge 与模拟用户的能力识别扫描规范化文本，注释不再触发识别。字符串里出现这些名字仍会被识别，属于保守误判。
非 JavaScript / TypeScript 文件（例如被 import 的 `.json`）继续按原始字节计算，条目使用 `r1:`。

### 身份域变更

登记一条 `behavior-changing` 变更，同时把 `fingerprintAlgorithm` 由 5 升到 6、`fingerprintCoverage` 由 3 升到 4：文件条目改为带配方前缀的哈希，能力识别扫描规范化文本，闭包成员与投影改由模块图决定。
不提供旧域重建：升级后所有已有结果显示 `identity-domain-changed`，重跑一次。这是用户接受的代价，换来不需要冻结旧材料、中间组合域与迁移谓词。
之后普通注释与排版修改仅在规范化文本相同、其它身份输入不变时沿用；换行与编译指令仍服从前述规则。

## 取舍

| 做法 | 优点 | 代价 | 判断 |
|---|---|---|---|
| A：解析器给区间，NiceEval 自己规范化（本方案） | 避免把完整 AST 形状作为身份；注释判定精确；同一份解析结果给出模块图 | 新增原生依赖；解析器拒绝的语法会阻止规划 | 采用 |
| B：AST 去掉位置后整体哈希 | 连换行都能忽略，自动分号插入语义由解析器保证 | 身份依赖解析器的 AST 形状，升级解析器可能整体作废 | 不采用：身份稳定性比多忽略换行更重要 |
| C：自写词法器去注释 | 无新依赖 | 正则字面量与除号有歧义，误判会把代码当成注释，导致不同程序共用身份，静默沿用错误结果 | 不采用：错误方向是静默错误 |
| D：用 TypeScript 的 JS parser 驱动 scanner | 使用 JS 发行时无原生 binding，可共用解析结果识别依赖 | 独立 scanner 无法自行决定正则、模板与 JSX 的语法上下文；需随包分发固定版本 | 选型备选，不作为运行时的平台回退 |

## 已知边界

- 运行时把源码文本当数据的写法不受保护：`Function.prototype.toString()` 或用 `fs` 读取自己的源码。改注释会改变这类程序的行为，身份却不变。Eval 读取文件应使用 `loadText`，它按原始字节进入身份。
- 把 `Error.stack` 的源码行列作为业务数据同样不受保护；规范化相等不保证原始行列相同。
- 规范化只针对注释与空白；格式化工具改动引号风格、尾逗号或括号会作废结果。

## 验收

- 同一 Eval 修改普通注释、缩进、空行，且每个 token 间有无换行保持相同：`exp --dry` 显示沿用。
- 把一行拆成两行、改字符串内容、改正则字面量：显示 `identity-mismatch`。
- 字符串或正则字面量里含 `//`、`/*`：规范化文本保留它们，修改这些字面量仍作废。
- 模板静态片段、嵌套 `${}`、JSX 文本与属性分别覆盖；编译指令修改必须改变身份。
- LF、CR、CRLF、U+2028、U+2029 与 Unicode 空白分别覆盖，`return/*\n*/value` 和 `return/* */value` 必须不同。
- HTML 风格注释、hashbang、类型位置注释、`/*#__PURE__*/` 与 `//# sourceMappingURL` 按实际装载器验证；只忽略不改变执行的注释。
- 注释掉的 import 指向的文件被修改：不影响该 Eval；去掉注释后它进入闭包。
- 注释里写 `agentJudge(`：载荷不出现 `agentJudge` 项。
- 用 NiceEval 升级前的 Record 运行 `--dry`：全部已有结果显示 `identity-domain-changed`，列出这条变更名；不出现 `identity-domain-unregistered` 或 `unversioned-identity-change`。
- 解析器报错与 binding 缺失分别以具名错误使规划失败，不产生任何身份；不使用错误恢复 AST。
- 依赖边规则表的每一行各有样例，`dynamic-module-unresolved` warning 写明文件与行列；discovery 的 loader 传播与指纹使用同一份模块图。
- tsconfig 本地别名、`module.require()`、`export = require()` 与仅类型导入分别验证；解析到同一真实文件的不同 specifier 共用模块事实。
- 公开读取 carried Attempt 的断言位置时，仍 join exact origin Run 的 Sources，不能用规范化哈希绑定当前文件。
- 发布校验的固定样例覆盖以上每种输入。
