# ReadonlyMaterial 递归 JSON 在公开声明上触发 TS2589

RPG 消费 b65a4ebe 候选，用 TypeScript 5.9.3、strict、skipLibCheck、ES2024，仅声明 ReadonlyMaterial<Json> 即出现 TS2589。Json 为包含 null、primitive、readonly Json[] 和 readonly string index 的递归联合，不依赖大型应用泛型。

现有类型在深只读映射前对 ManagedToolCalls 与 ManagedEventOccurrences 做结构条件匹配；需以最小安装候选类型入口定位和修复递归展开。不得用 any、类型断言、材料截断或限制深度绕过，现有 managed 品牌、函数返回、Map/Set 及深只读负例必须保留。
