# 源码身份与冻结模块图

发现阶段建立一份冻结模块图。源码身份、受管输入传播、Eval Group 定义摘要与 Sources 捕获都使用这份图。
普通注释、缩进和空行只有在不改变规范化文本时才允许沿用结果；字符串、编译指令与实际依赖仍属于运行输入。
结果沿用和差异说明由[缓存与携带](cache.md)拥有。

## 身份输入

从每个实际参与执行的入口构建有根模块图。执行指纹包含入口角色、节点的装载模式与内容、节点间有序的依赖边。owner 内源文件的位置保存在 manifest，供定位和审计。
JavaScript / TypeScript 节点使用下文的规范化文本。其它内容按原始字节求摘要。包依赖保留实际解析的入口、安装内容及装载条件。
Sources 与断言位置保存原始字节，并通过实际执行的 origin Run 关联；不能用规范化后的文本替代证据。

loader 数据、criteria、private 文件和 transfer manifest 保持各自的原始内容身份。
变量改名、语句换序与其它语义等价改写没有自动沿用保证。

## 移动源码时的执行指纹

从根按源码中的依赖出现顺序遍历，首次遇到真实模块时分配节点序号，再次遇到时引用同一序号。按此顺序编码节点及边，再对整张图求摘要。
这能区分共享一个模块实例与加载两份相同代码，也能表示环。边保留导入种类、绑定、顺序与求值时机；只有静态解析到 owner 内模块的定位字符串才以目标节点引用代入。
因此从另一个目录导入同一个判分函数可保持指纹。交换两个不同判分函数的绑定会改变指纹。

发现器单独解析[入口 ID](../../eval/library/README.md#定义入口的-id)。仅作发现声明的导出从执行文本中移除，把有效 ID 固定为原来的默认值可以沿用。
若代码读取这个绑定或观察入口的导出集合，保留可观察的声明及其值。字符串、模板、普通参数中长得像路径的文本仍按原规则比较。

| 路径的用途 | 指纹中的输入 |
| --- | --- |
| 定位受管 loader 或静态上传的源文件 | 读取位置在代码中的顺序、读取方式、解析后的内容。目录还包含选中文件的树内相对名与字节 |
| Agent 可见的 Sandbox 路径 | 上传目标、文件树、权限等实际执行输入；目标路径改变即重新规划 |
| 业务代码读取模块 URL、文件名或目录名 | 可完整求值时计入实际可见值。例如将 `import.meta.url` 写入 prompt，移动后须重跑 |
| 动态读取、反射或不透明组件可能观察位置 | 无法证明输入完整时，该配对不能自动沿用，计划指出相关模块与原因 |

只有识别出受管操作且能证明定位表达式的值仅用于该操作时，才按解析结果代入。位置值另有读者时保留其行为输入。
这套规则同样约束 Experiment 配置、Adapter、Provider 和 Plugin 贡献的输入；任一 owner 无法证明等价时，不能由顶层指纹忽略它的差异。
每次发现仍按当前真实路径执行 owner 边界、模块解析和文件访问检查。

## 规范化规则

源码扩展名包括 `.ts`、`.tsx`、`.mts`、`.cts`、`.js`、`.jsx`、`.mjs` 与 `.cjs`。
解析器提供注释与受保护区间，NiceEval 按以下规则生成规范化文本，不对整棵 AST 求哈希：

1. 除上节明确处理的定位表达式与声明外，字符串、模板静态片段、正则、JSX 文本及引号属性、hashbang 和指令原样保留。
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

项目装载器与 CLI 必须共享同一份 NiceEval 运行时，包括每一代 fresh import。
启用 `niceeval-source` 时，公开入口使用 Node 在当前条件下解析的源码模块，不能混入 dist 中的另一份实现。
装载器从本安装的 package exports 取得精确入口，按需加载；不维护第二份入口表，也不开放未导出的子路径。
项目模块可以重新求值，NiceEval 的定义身份与 Sandbox 能力登记则始终属于同一个运行时。

依赖无法确定时，`exp --dry` 显示 `dynamic-module-unresolved`、文件与行列。
改成字面量加载或使用 `loadText` 等受管输入后，作者可重新取得完整身份。
`import.meta.glob` 等装载器不支持的扩展不属于保证范围。

能力选择扫描规范化文本，普通注释不触发 Agent Judge、普通 Judge 或模拟用户身份。
字符串中的能力名仍可形成保守选择。只有依赖该能力的 Eval 才加入对应内容摘要与行为计数。
Eval Group 定义模块使用同样的文件摘要与模块图，非源码的 Group 输入仍按其实际内容计算。

## 框架声明与准备输入

框架生成的 hook 状态、Provider plan、Sandbox template、Plugin pair、Eval Group 与复用池描述，
只保存实际输入，不附固定的编码 `version`。hook 仍区分 absent 与 opaque；Provider 和插件作者声明的行为 revision 保留。
Group 的源码摘要、顺序、层与 onUnavailable，复用池的 scope、实例所有权与物理生命周期都继续参与身份。
复用池 key 的域分隔名称为 `sandbox-reuse-pool`，不附编码版本。

Docker build manifest 的摘要来自 scopeId、buildKey、provider 与 inputs，不重复加入 schemaVersion。
DinD 准备身份对实际 bootstrap、supervisor 文本与 quiesce 命令数组组成的有序 JSON tuple 取 SHA-256；
任一执行文本变化都会改变摘要，不用手写 revision 代替。普通排版变化不改变执行文本时，摘要不变。

当前目标策略的行为计数由 runner 的 `projectTargetPolicyIdentity` 唯一拥有。
Host dry 输出直接使用该值及其类型，不能另写一个固定副本。

## 边界与验收

将源码本身作为业务数据的 `Function.prototype.toString()`、直接文件读取或依赖 `Error.stack` 行列的逻辑，不享有注释等价保证。
需要让文件原文参与判断时使用受管 loader。

- 普通注释、缩进与空行变化，在规范化文本相同时保持沿用；字符串、正则、模板、JSX 或编译指令变化使身份不同。
- Unicode、HTML 注释、hashbang 与自动分号插入分别验证，不能把不同程序归成同一摘要。
- 注释中的 import 不形成依赖；真正的字面量动态加载进入闭包，但不提前执行。
- 别名、遮蔽、仅类型依赖与 Group 条件依赖遵循上表，无法确定的动态加载明确拒绝沿用。
- Sources 保存原文，携带结果的断言位置仍关联 exact origin Run。
- 旧 Record 格式在打开时拒绝，当前格式中身份不相等的结果重新执行；不重建历史身份或自动采用。
