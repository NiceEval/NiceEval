// 包外用户报告的等价副本:一个普通用户会写的 --report 文件,只从 niceeval/report 的公开
// barrel(这里按测试约定用相对源码路径 src/report/index.ts)import 积木,零内部路径、零数据装配。
//
// 它与 src/report/built-ins/experiment-comparison.tsx 的 build 函数除 import 路径与 export
// 形式外必须逐节点同构(同一棵 <Col> / MetricScatter / ExperimentList、同一组 props、同一对指标)。
// built-in-user-parity.test.tsx 以这份 fixture 证明「内置报告就是普通用户报告」——同一 Selection 下
// 两者 resolve 出的树结构化相等,渲染出的事实相同,而不是靠注释声称。

import { Col, ExperimentList, MetricScatter, costUSD, defineReport, taskPassRate } from "../../../src/report/index.ts";

export default defineReport(async ({ selection }) => {
  const experiments = await ExperimentList.data(selection);
  return (
    <Col>
      <MetricScatter selection={selection} points="experiment" series="agent" x={costUSD} y={taskPassRate} />
      <ExperimentList items={experiments} filter />
    </Col>
  );
});
