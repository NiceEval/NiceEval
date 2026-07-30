/*
 * 图：一个 .eval.ts 文件怎么展开成多条评估用例，以及两种导出形态各自生成什么 id。
 * 一图一个组件，内容写死在组件里。样式在 styles/diagram-dataset-fanout.css。
 *
 * 写法约束同 snippets/widgets.jsx：只写箭头函数、不写 import、模块作用域里不放未导出的变量。
 */
export const DatasetFanout = () => (
  <div className="ne-w ne-fan">
    <div className="ne-hd">
      一个文件展开成几条评估用例
      <span className="ne-hd-hint">evals/sql.eval.ts</span>
    </div>

    <div className="ne-fan-block">
      <div className="ne-fan-kind">
        默认导出数组
        <span className="ne-fan-lead">没有外部业务 ID 时</span>
      </div>
      <div className="ne-fan-grid">
        <div className="ne-fan-row ne-lit" style={{ animationDelay: "0s" }}>
          <span className="ne-fan-data">{'{ task: "Count users", … }'}</span>
          <span className="ne-fan-arrow">▸</span>
          <span className="ne-fan-id">sql/0000</span>
        </div>
        <div className="ne-fan-row ne-lit" style={{ animationDelay: "0.7s" }}>
          <span className="ne-fan-data">{'{ task: "Recent orders", … }'}</span>
          <span className="ne-fan-arrow">▸</span>
          <span className="ne-fan-id">sql/0001</span>
        </div>
        <div className="ne-fan-row ne-lit" style={{ animationDelay: "1.4s" }}>
          <span className="ne-fan-data">{'{ task: "Top spenders", … }'}</span>
          <span className="ne-fan-arrow">▸</span>
          <span className="ne-fan-id">sql/0002</span>
        </div>
      </div>
      <p className="ne-why">序号按数组下标零填充，加一行数据不会打乱前面的 id。</p>
    </div>

    <div className="ne-fan-block">
      <div className="ne-fan-kind">
        默认导出 keyed record
        <span className="ne-fan-lead">数据源自带稳定 ID 时</span>
      </div>
      <div className="ne-fan-grid">
        <div className="ne-fan-row ne-lit" style={{ animationDelay: "2.4s" }}>
          <span className="ne-fan-data">{'"ISSUE-42": defineEval({ … })'}</span>
          <span className="ne-fan-arrow">▸</span>
          <span className="ne-fan-id">sql/ISSUE-42</span>
        </div>
        <div className="ne-fan-row ne-lit" style={{ animationDelay: "3.1s" }}>
          <span className="ne-fan-data">{'"ISSUE-77": defineEval({ … })'}</span>
          <span className="ne-fan-arrow">▸</span>
          <span className="ne-fan-id">sql/ISSUE-77</span>
        </div>
      </div>
      <p className="ne-why">键就是 id 的后半段，跨批次引用同一道题不用查下标。</p>
    </div>

    <div className="ne-ft">
      两种形态都按 id 前缀过滤：<code>niceeval exp local sql/</code> 跑整份测试集，
      <code>sql/ISSUE-42</code> 只跑一条。
    </div>
  </div>
);
