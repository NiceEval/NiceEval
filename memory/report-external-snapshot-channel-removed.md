# External snapshot 宿主注入通道删除，外部数据走 import 冻结

- **裁决**（2026-07-29）：删除报告的 External snapshot 宿主注入通道——
  page render 第二参数、`defineReport<External>` 泛型与 `--data` flag 全部移除。
  外部业务数据的唯一入口是报告文件 import 的冻结快照模块
  （运行前由脚本写盘、随报告进版本库）。
- **曾选方案**：`--data <json-file>` 或项目配置注入，宿主在未配置时传冻结空值
  （architecture.md 旧「外部冻结值」小节）。
- **否决理由**：
  1. 它是幽灵契约——show/view 没定义 `--data`，CLI 无此 flag，config 无对应字段，
     数据格式、相对路径基准、深冻结、缓存身份、watch 闭集、导出 provenance、
     缺数据反馈全部未定，闭合这些要一整套新契约。
  2. 与库自己的原则自相矛盾：library.md 明写「CLI 不开报告参数」，
     `--data` 就是穿着宿主 flag 外衣的报告参数。
  3. import 版把这些问题全部白拿：快照文件在报告 import 图内，
     缓存身份、watch 重建、字节稳定复现与出处审计都复用既有的模块图规则。
  4. 差异化收益为零——「不改代码换数据」在两个方案里都是改一个磁盘文件。
- 图表层 `external: true` 声明与本裁决无关，保留：它标记的是「无 Attempt 证据的行」，
  与数据从哪来正交。
- 落点：docs/feature/reports/{architecture,library}.md、library/shell.md、README.md、
  use-case 构建报告两篇、docs-site zh/reference/report-components.mdx。
