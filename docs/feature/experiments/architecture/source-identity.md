# 源码身份与冻结模块图

发现阶段建立一份冻结模块图。源码身份、受管输入传播、Eval Group 定义摘要与 Sources 捕获都使用这份图。
普通注释、缩进和空行只有在不改变规范化文本时才允许沿用结果；字符串、编译指令与实际依赖仍属于运行输入。
结果沿用和差异说明由[缓存与携带](cache.md)拥有。

## 身份输入

每个闭包文件以 `[owner 相对路径, sha256]` 进入身份，manifest 保存同一摘要，不附编码版本或配方前缀。
JavaScript / TypeScript 文件对规范化文本求哈希，其它文件按原始字节求哈希。
Sources 与断言位置保存原始字节，并通过实际执行的 origin Run 关联；不能用规范化后的文本替代证据。

loader 数据、criteria、private 文件和 transfer manifest 保持各自的原始内容身份。
变量改名、语句换序与其它语义等价改写没有自动沿用保证。

## 规范化规则

源码扩展名包括 `.ts`、`.tsx`、`.mts`、`.cts`、`.js`、`.jsx`、`.mjs` 与 `.cjs`。
解析器提供注释与受保护区间，NiceEval 按以下规则生成规范化文本，不对整棵 AST 求哈希：

1. 字符串、模板静态片段、正则、JSX 文本及引号属性、hashbang 和指令原样保留。
   模板的 `${}` 内继续处理表达式，静态片段的 raw 文本不变。
2. 编译器指令注释原样保留，包括 `@jsx`、`@jsxFrag`、`@jsxRuntime` 与 `@jsxImportSource`。
   指令集合按实际装载器确定；不能证明是普通注释的编译指令保留原文。
3. 普通注释有换行时替换为一个换行，否则替换为一个空格。
4. 受保护区间外的连续空白有换行时折叠为 `\n`，否则折叠为一个空格；删除文件首尾空白。

换行包含 LF、CR、CRLF、U+2028 与 U+2029，其它空白遵循 ECMAScript 语法。
注释替换后的空白也参与折叠。HTML 风格注释按所属模块的 script / module 语法处理。
所有区间使用 UTF-16 索引，不能与 UTF-8 字节偏移混用。

规范化保留 token 之间是否有换行，因此 `return\nvalue` 与 `return value` 不同。
增删带换行的块注释、拆行或并行都可能改变自动分号插入，必须按规范化结果判断身份。
引号、括号与尾逗号也属于源码；格式化工具改变它们时允许结果失效。

## 解析器与装载模式

解析器固定为 `oxc-parser` 0.158.0，只使用与版本一致的原生 binding。
规划前检查平台对应的原生包；缺失时报告平台与包名，不安装依赖，也不回退到 WASM 或 WebContainer。
任何 `NAPI_RS_` 环境变量都会使规划失败，错误只列变量名，不输出变量值。

语言由扩展名决定：`.ts`、`.mts`、`.cts` 使用 TypeScript，`.tsx` 使用 TSX，`.jsx` 使用 JSX，其余使用 JavaScript。
`.mjs`、`.mts` 按 module 处理，`.cjs`、`.cts` 按 CommonJS 处理；其它扩展名按最近 `package.json` 的 `type` 判断，未声明时为 CommonJS。

解析失败时规划报告文件、行列、语法模式与解析器消息，不使用错误恢复 AST，也不退回原始字节身份。
读取固定历史 Run 不依赖当前源码能否解析。解析器升级属于 NiceEval 身份输入变化，受影响的结果按当前规则重新执行。

## 模块依赖

模块图保存语法种类与求值时机。保守收集依赖不授权 fresh import 提前执行条件分支。
specifier 使用 AST 解码后的字符串，并按 jiti 实际模块解析规则查找。

| 写法 | 闭包行为 |
| --- | --- |
| 值导入、side-effect import、值重导出 | 收集实际模块 |
| 整句或全部成员为 type 的 import / export | 不收集被擦除的类型依赖 |
| 值与 type 混合导入 | 保守收集，不能据此提前求值 |
| 字符串字面量 `import()` | 收集，包括未执行分支 |
| 未被遮蔽的字面量 `require()`、`module.require()` | 收集 |
| TypeScript `import x = require()`、`export = require()` | 按对应运行期调用收集 |
| 非字面量动态加载、require 别名、createRequire 返回的函数 | 标记依赖无法确定，涉及的 Eval 每次执行 |

解析到 owner 内源码的 tsconfig 别名与 package imports 映射进入同一模块图。
同一真实文件只形成一份模块事实。可达 bare dependency 使用实际安装内容身份。
Node builtin 与 NiceEval 运行时不进入用户源码闭包。
realpath 校验和逃出 owner 的处理遵循 [Eval 文件访问边界](../../eval/architecture.md#文件访问边界)。

依赖无法确定时，`exp --dry` 显示 `dynamic-module-unresolved`、文件与行列。
改成字面量加载或使用 `loadText` 等受管输入后，作者可重新取得完整身份。
`import.meta.glob` 等装载器不支持的扩展不属于保证范围。

能力选择扫描规范化文本，普通注释不触发 Agent Judge、普通 Judge 或模拟用户身份。
字符串中的能力名仍可形成保守选择。只有依赖该能力的 Eval 才加入对应内容摘要与行为计数。
Eval Group 定义模块使用同样的文件摘要与模块图，非源码的 Group 输入仍按其实际内容计算。

## 边界与验收

将源码本身作为业务数据的 `Function.prototype.toString()`、直接文件读取或依赖 `Error.stack` 行列的逻辑，不享有注释等价保证。
需要让文件原文参与判断时使用受管 loader。

- 普通注释、缩进与空行变化，在规范化文本相同时保持沿用；字符串、正则、模板、JSX 或编译指令变化使身份不同。
- Unicode、HTML 注释、hashbang 与自动分号插入分别验证，不能把不同程序归成同一摘要。
- 注释中的 import 不形成依赖；真正的字面量动态加载进入闭包，但不提前执行。
- 别名、遮蔽、仅类型依赖与 Group 条件依赖遵循上表，无法确定的动态加载明确拒绝沿用。
- Sources 保存原文，携带结果的断言位置仍关联 exact origin Run。
- 旧 Record 格式在打开时拒绝，当前格式中身份不相等的结果重新执行；不重建历史身份或自动采用。
