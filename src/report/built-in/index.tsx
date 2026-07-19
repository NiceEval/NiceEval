// niceeval/report/built-in —— 内建视图的家:每个内建视图是一份普通 defineReport 成品,
// 有自己的名字、一个源文件,按名字具名导出;默认导出恒等于 standard——裸宿主装载的那份
// (docs/feature/reports/library/built-in.md)。新增内建视图 = 新文件 + 新具名导出,
// 不需要注册表,也不改变装载管线。

import { standard, standardAttemptPage } from "./standard.tsx";

export { standard, standardAttemptPage };

export default standard;
