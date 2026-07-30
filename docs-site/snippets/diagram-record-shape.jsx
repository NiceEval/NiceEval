/*
 * 图：磁盘上是 Record ⊃ experiment ⊃ Run ⊃ attempt，两个官方口径各自从里面挑出哪些结果。
 * 一图一个组件，内容写死在组件里。切面板的机制与 Picker 共用（styles/tabs.css），
 * 这张图自己的样式在 styles/diagram-record-shape.css。
 *
 * 写法约束同 snippets/widgets.jsx：只写箭头函数、不写 import、模块作用域里不放未导出的
 * 变量。两个口径各画一份完整的 Record，选哪个就显示哪一份。
 */
export const RecordShape = () => (
  <div className="ne-w ne-rec">
    <div className="ne-hd">
      同一份 Record，两个口径
      <span className="ne-hd-hint">周一跑了整组，周二只重跑了 q/sum</span>
    </div>

    <input className="ne-pick-in" type="radio" name="ne-rec-sample" id="ne-rec-0" defaultChecked />
    <input className="ne-pick-in" type="radio" name="ne-rec-sample" id="ne-rec-1" />

    <div className="ne-tabs">
      <label className="ne-tab" htmlFor="ne-rec-0">
        currentSample
      </label>
      <label className="ne-tab" htmlFor="ne-rec-1">
        latestRunSample
      </label>
    </div>

    <div className="ne-panels">
      <div className="ne-panel ne-rec-panel">
        <div className="ne-rec-exp">compare/bub</div>
        <div className="ne-rec-run">
          <span className="ne-rec-when">Run · 周一</span>
          <span className="ne-rec-cell">q/sum</span>
          <span className="ne-rec-cell ne-rec-on">✓ q/area</span>
          <span className="ne-rec-cell ne-rec-on">✓ q/limit</span>
        </div>
        <div className="ne-rec-run">
          <span className="ne-rec-when">Run · 周二</span>
          <span className="ne-rec-cell ne-rec-on">✓ q/sum</span>
        </div>

        <div className="ne-rec-exp">compare/codex</div>
        <div className="ne-rec-run">
          <span className="ne-rec-when">Run · 周一</span>
          <span className="ne-rec-cell ne-rec-on">✓ q/sum</span>
          <span className="ne-rec-cell ne-rec-on">✓ q/area</span>
          <span className="ne-rec-cell ne-rec-on">✓ q/limit</span>
        </div>

        <p className="ne-why">
          每道题当前可用的判定：q/sum 取周二那次，q/area 与 q/limit 取周一那次。六道题都有结果，
          <code>coverage</code> 没有缺口。<code>niceeval show</code> / <code>view</code> 的默认首页用这个口径。
        </p>
      </div>

      <div className="ne-panel ne-rec-panel">
        <div className="ne-rec-exp">compare/bub</div>
        <div className="ne-rec-run">
          <span className="ne-rec-when">Run · 周一</span>
          <span className="ne-rec-cell">q/sum</span>
          <span className="ne-rec-cell">q/area</span>
          <span className="ne-rec-cell">q/limit</span>
        </div>
        <div className="ne-rec-run">
          <span className="ne-rec-when">Run · 周二</span>
          <span className="ne-rec-cell ne-rec-on">✓ q/sum</span>
        </div>
        <div className="ne-rec-gap">
          <span className="ne-rec-when" />
          <span className="ne-warn">
            <span className="ne-mono">!</span> missingEvalIds: q/area、q/limit
          </span>
        </div>

        <div className="ne-rec-exp">compare/codex</div>
        <div className="ne-rec-run">
          <span className="ne-rec-when">Run · 周一</span>
          <span className="ne-rec-cell ne-rec-on">✓ q/sum</span>
          <span className="ne-rec-cell ne-rec-on">✓ q/area</span>
          <span className="ne-rec-cell ne-rec-on">✓ q/limit</span>
        </div>

        <p className="ne-why">
          每个实验最新一次 Run 实际产出了什么：bub 的最新 Run 是周二那次，里面只有一道题，
          缺的两道写进 <code>coverage.missingEvalIds</code>，报告渲染成占位行加补跑命令，不静默。
        </p>
      </div>
    </div>

    <div className="ne-ft">
      Run 就是 <code>.niceeval/&lt;experiment&gt;/&lt;run&gt;/</code> 这个目录，没有更低一层；
      两个口径都返回一个 Sample，Attempt、贡献 Run、<code>coverage</code> 与 <code>issues</code> 绑在一起走。
    </div>
  </div>
);
