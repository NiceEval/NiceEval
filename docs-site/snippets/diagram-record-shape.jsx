/*
 * 图：同一份固定 Record，两个用户旅途——默认首页的 current Contribution 视图与单 Run 审计视图。
 * 一图一个组件，内容写死在组件里。切面板的机制与 Picker 共用（styles/tabs.css），
 * 这张图自己的样式在 styles/diagram-record-shape.css。
 *
 * 写法约束同 snippets/widgets.jsx：只写箭头函数、不写 import、模块作用域里不放未导出的
 * 变量。两个旅途各画一份固定 Graph 上的成员选择，选哪个就显示哪一份。
 */
export const RecordShape = () => (
  <div className="ne-w ne-rec">
    <div className="ne-hd">
      同一份固定 Record：默认首页与单 Run 审计
      <span className="ne-hd-hint">周一跑了整组，周二只重跑了 q/sum</span>
    </div>

    <input className="ne-pick-in" type="radio" name="ne-rec-sample" id="ne-rec-0" defaultChecked />
    <input className="ne-pick-in" type="radio" name="ne-rec-sample" id="ne-rec-1" />

    <div className="ne-tabs">
      <label className="ne-tab" htmlFor="ne-rec-0">
        默认首页
      </label>
      <label className="ne-tab" htmlFor="ne-rec-1">
        单 Run 审计
      </label>
    </div>

    <div className="ne-panels">
      <div className="ne-panel ne-rec-panel">
        <div className="ne-rec-exp">compare/bub</div>
        <div className="ne-rec-run">
          <span className="ne-rec-when">Run · r16（周一）</span>
          <span className="ne-rec-cell">q/sum</span>
          <span className="ne-rec-cell ne-rec-on">✓ q/area</span>
          <span className="ne-rec-cell ne-rec-on">✓ q/limit</span>
        </div>
        <div className="ne-rec-run">
          <span className="ne-rec-when">Run · r17（周二）</span>
          <span className="ne-rec-cell ne-rec-on">✓ q/sum</span>
        </div>

        <div className="ne-rec-exp">compare/codex</div>
        <div className="ne-rec-run">
          <span className="ne-rec-when">Run · r16（周一）</span>
          <span className="ne-rec-cell ne-rec-on">✓ q/sum</span>
          <span className="ne-rec-cell ne-rec-on">✓ q/area</span>
          <span className="ne-rec-cell ne-rec-on">✓ q/limit</span>
        </div>

        <p className="ne-why">
          固定 Graph 上每个 membership slot 的 current Contribution：q/sum 由 r17 的
          <code>executed</code> 贡献，q/area 与 q/limit 由 r16 的 <code>carried</code> 贡献。
          六道题都有结果，<code>coverage</code> 没有缺口。<code>niceeval show</code> / <code>view</code>
          的默认首页消费这份固定 Sample 的 coverage 与 MetricValue，不按时间重选。
        </p>
      </div>

      <div className="ne-panel ne-rec-panel">
        <div className="ne-rec-exp">compare/bub</div>
        <div className="ne-rec-run">
          <span className="ne-rec-when">Run · r16（周一）</span>
          <span className="ne-rec-cell ne-rec-on">✓ q/sum</span>
          <span className="ne-rec-cell ne-rec-on">✓ q/area</span>
          <span className="ne-rec-cell ne-rec-on">✓ q/limit</span>
        </div>
        <div className="ne-rec-run">
          <span className="ne-rec-when">Run · r17（周二）</span>
          <span className="ne-rec-cell ne-rec-on">✓ q/sum</span>
        </div>
        <div className="ne-rec-gap">
          <span className="ne-rec-when" />
          <span className="ne-warn">
            <span className="ne-mono">!</span> 收窄到 r16：q/area、q/limit 在该 revision 的 slot 中 unavailable
          </span>
        </div>

        <div className="ne-rec-exp">compare/codex</div>
        <div className="ne-rec-run">
          <span className="ne-rec-when">Run · r16（周一）</span>
          <span className="ne-rec-cell ne-rec-on">✓ q/sum</span>
          <span className="ne-rec-cell ne-rec-on">✓ q/area</span>
          <span className="ne-rec-cell ne-rec-on">✓ q/limit</span>
        </div>

        <p className="ne-why">
          单 Run 审计是显式 Run selection 生成的另一份固定 Sample（<code>--run</code> 或
          <code>materializeSample</code> 的 runs 选择）：只显示该 revision 的 membership。
          与默认首页不同的成员集合来自不同的固定选择，不是同一份 Sample 漂移。
        </p>
      </div>
    </div>

    <div className="ne-ft">
      Run 是一次提交的持久化执行批次，没有更低一层；
      默认报告消费固定 Sample 的 current Contribution；单 Run 审计是另一份固定 Sample 的显式选择。
      两者都让 Attempt、贡献 Run、<code>coverage</code> 与 <code>provenance</code> 绑在一起走。
    </div>
  </div>
);
