# Eval 源码身份忽略注释与排版

## 要决定什么

Eval 源码闭包现在按文件原始字节计算内容哈希。只改注释、缩进或空行，也会让依赖这份源码的结果全部作废，只能付费重跑。
NiceEval-Eval 这类付费评测项目因此不敢整理注释，也不敢格式化 Eval 源码。

本设计决定：源码闭包里的 JavaScript / TypeScript 文件按什么规范化文本计算身份，怎样迁移已有结果，以及哪些情况仍按原始字节计算。

非目标：

- 不改变 loader 数据、criteria、private 文件与 transfer manifest 的哈希方式；它们是数据，格式变化可能就是语义变化。
- 不让语义等价的改写（改变量名、调整语句顺序）沿用结果。
- 不改变 Provider、installer 等 owner 声明的身份。

## 现状

- `runner/fingerprint.ts` 的 `sourceClosure` 从 Eval 入口出发，用正则匹配 `import` / `export ... from` 找相对模块。
  指纹载荷保存 `[相对路径, 原始文本]`，manifest 保存文本哈希。旧域重建必须保留这个区别。
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
- 语言与模块类型按扩展名决定：`.ts`、`.mts` 为 TypeScript module，`.cts` 为 TypeScript CommonJS，`.tsx` 为 TSX，`.js`、`.mjs` 为 module，`.cjs` 为 CommonJS，`.jsx` 为 JSX。
- 区间按解析器返回的 UTF-16 索引切片，不与 UTF-8 字节偏移混用。

解析器报告任何错误时，规划失败并给出文件、行列与解析器消息，不使用错误恢复得到的 AST，也不退回原始字节。
jiti 能运行而解析器拒绝的语法因此会阻止规划；这比用不完整的闭包或另一种编码计算身份更安全。
升级解析器时，发布校验的固定样例必须证明规范化文本、依赖成员与能力选择全部不变，否则更换 `fingerprintAlgorithm`。

### 闭包成员与能力识别

模块依赖只有一个 owner：发现阶段用解析器为每个模块建立依赖边，形成冻结的模块图。
loader、criteria 与 private 输入的逐 Eval 传播、Eval Group 的 definition hash、源码捕获与指纹都消费这一份模块图。
`runner/source-closure.ts`、`fingerprint.ts` 与 fresh import 里的正则扫描全部删除，不再各自扫描磁盘。

依赖边按以下规则收集，specifier 使用 AST 解码后的字符串，按 jiti 实际使用的模块解析规则查找：

| 写法 | 是否进入闭包 |
| --- | --- |
| `import ... from`、`import "x"`、`export ... from`、`export * from` | 进入 |
| 整句的 `import type` 与 `export type` | 不进入：编译后不执行目标模块 |
| 同一句里混有值与 `type` 修饰的导入 | 进入：仍执行目标模块 |
| 参数为字符串字面量的 `import()` | 进入，不论这个分支是否执行 |
| 参数为字符串字面量、且 `require` 未被局部遮蔽的 `require()`；TypeScript `import x = require()` | 进入 |
| 参数不是字符串字面量的 `import()` 或 `require()` | 不进入；规划给出 `dynamic-module-unresolved` warning，写明文件与行列 |

查找结果按 realpath 遵守 [Eval 架构](../feature/eval/architecture.md#文件访问边界) 的 owner 边界；包名依赖（不以 `.` 或 `/` 开头的 specifier）沿用既有的安装内容摘要规则。

Agent Judge、普通 Judge 与模拟用户的能力识别扫描规范化文本，注释不再触发识别。字符串里出现这些名字仍会被识别，属于保守误判。
非 JavaScript / TypeScript 文件（例如被 import 的 `.json`）继续按原始字节计算，条目使用 `r1:`。

### 身份域迁移

登记两条 `encoding-only` 变更，各自负责一个 revision：

| 变更 | 内容 |
|---|---|
| `fingerprint-algorithm/5-to-6` | 文件条目由原文改为带配方前缀的哈希；能力识别扫描规范化文本；解析器版本与选项进入配方 |
| `fingerprint-coverage/3-to-4` | 闭包成员与 loader、criteria、private 的逐 Eval 投影改由模块图决定 |

三个组合域的配方：

| 组合域 | 闭包成员与投影 | 文件条目 | 能力识别 |
| --- | --- | --- | --- |
| algorithm 5 / coverage 3（旧） | 旧正则 | 原文 | 原文 |
| algorithm 6 / coverage 3（中间） | 旧正则 | 带配方前缀的哈希 | 规范化文本 |
| algorithm 6 / coverage 4（新） | 模块图 | 带配方前缀的哈希 | 规范化文本 |

registry 按相反顺序重建：先由 coverage 4 还原到中间域，再由 algorithm 6 还原到旧域。

规划发现 origin 处于旧域时，一次性冻结迁移材料：旧正则闭包的成员、每个成员的原文与规范化文本、旧投影，以及新旧配方各自的能力识别结果。
重建只消费这份冻结材料，不再读磁盘。旧闭包独有的文件无法读取或无法解析时，只判这次迁移不可用，不阻止当前身份的规划。

两步各有谓词，任一不成立即拒绝重建，结果显示 `identity-domain-changed`：

- coverage 4 → 3：新闭包的每个成员都属于旧闭包，且每条 Eval 的 loader、criteria 与 private 投影在两种成员规则下相同。
  旧闭包多出的成员（例如只出现在注释里的 import）不阻止迁移；新闭包多出的成员会阻止，因为旧结果从未覆盖它。
- algorithm 6 → 5：Agent Judge、普通 Judge 与模拟用户的能力识别在原文与规范化文本上得到相同结果。

例如入口一直写着 `import("./worker.ts")`：旧正则闭包没有 `worker.ts`，第一条谓词不成立，这条 Eval 重跑一次，不会因为旧 digest 恰好相等而沿用。
模拟用户等能力条件项各自的行为版本按所属 owner 的身份规则处理，源码编码迁移不改变它们。

后果：

- 升级 NiceEval 后，源码未变、闭包没有新增成员、能力识别不变的 Eval 直接沿用，不需要重跑，也不需要 `accept`。
- 升级前后都改过源码的 Eval，与今天一样作废；升级之后，只改普通注释与排版不再作废。
- 闭包因新规则新增了成员的 Eval（例如用到 `import()` 或 `require`）重跑一次。

## 取舍

| 做法 | 优点 | 代价 | 判断 |
|---|---|---|---|
| A：解析器给区间，NiceEval 自己规范化（本方案） | 避免把完整 AST 形状作为身份；注释判定精确；同一份解析结果给出模块图 | 新增原生依赖；解析器拒绝的语法会阻止规划 | 采用 |
| B：AST 去掉位置后整体哈希 | 连换行都能忽略，自动分号插入语义由解析器保证 | 身份依赖解析器的 AST 形状，升级解析器可能整体作废 | 不采用：身份稳定性比多忽略换行更重要 |
| C：自写词法器去注释 | 无新依赖 | 正则字面量与除号有歧义，误判会把代码当成注释，导致不同程序共用身份，静默沿用错误结果 | 不采用：错误方向是静默错误 |
| D：用 TypeScript 的 JS parser 驱动 scanner | 使用 JS 发行时无原生 binding，可共用解析结果识别依赖 | 独立 scanner 无法自行决定正则、模板与 JSX 的语法上下文；需随包分发固定版本 | 选型备选，不作为运行时的平台回退 |

## 已知边界

- 运行时把源码文本当数据的写法不受保护：`Function.prototype.toString()` 或用 `fs` 读取自己的源码。改注释会改变这类程序的行为，身份却不变。Eval 读取文件应使用 `loadText`，它按原始字节进入身份。
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
- 用 NiceEval 升级前的 Record 运行 `--dry`：满足谓词的 Eval 显示 `match`，`via` 列出对应变更名。
  新增未被旧域覆盖的依赖及新增非等价能力条件项拒绝重建；不得自动沿用。
- 纯编码迁移、纯覆盖迁移、组合迁移及谓词不成立分别验证；冻结后改变磁盘内容不能影响重建结果。
- 解析器报错与 binding 缺失分别以具名错误使规划失败，不产生任何身份；不使用错误恢复 AST。
- 依赖边规则表的每一行各有样例，`dynamic-module-unresolved` warning 写明文件与行列；discovery 的 loader 传播与指纹使用同一份模块图。
- 公开读取 carried Attempt 的断言位置时，仍 join exact origin Run 的 Sources，不能用规范化哈希绑定当前文件。
- 发布校验的固定样例覆盖以上每种输入。
