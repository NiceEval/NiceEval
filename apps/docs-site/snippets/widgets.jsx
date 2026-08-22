/*
 * 文档站的交互与动画组件。页面用 props 传数据，组件只负责呈现。
 *
 * 观感按仓库根 DESIGN.md：1px 边表达区域、零圆角、无渐变无阴影，颜色只在有语义时出现，
 * 判定符号与文字始终同场。令牌值在 styles/base.css（浅色取 chalk，深色取 basalt）。
 *
 * 三条写法约束来自 Mintlify 把 JSX snippet 内联进 MDX 的方式，别改：
 * 只写箭头函数（它的 MDX 解析器只对箭头函数可靠）；不写 import；模块作用域里不放
 * 未导出的辅助变量（内联进来的只有导出本身）。因此交互一律由 CSS 的 :checked / :has()
 * 完成，不用 hook——顺带保住了「关掉 JavaScript 每个面板照常可读」。
 */

/**
 * tone → 判定符号。带语义色的必须同时带符号，见 DESIGN.md「判定不依赖颜色单独表意」；
 * 不带 tone 的条目没有好坏含义，也就不该配符号。
 */
export const neSymbol = (tone) => (tone === "pos" ? "✓" : tone === "neg" ? "✗" : tone === "warn" ? "!" : "");

/**
 * 选择器：选一个条件，看它带来的结果。
 * name 在同一页内唯一（同页两个 Picker 用不同 name，否则单选组会串）。
 * items[i] = { tab, tone?: "pos" | "neg" | "warn", lead, why?: 节点数组 }
 */
export const Picker = ({ name, title, hint, note, items = [] }) => (
  <div className="ne-w ne-pick">
    <div className="ne-hd">
      {title}
      {hint ? <span className="ne-hd-hint">{hint}</span> : null}
    </div>
    {items.map((item, i) => (
      <input
        key={`in-${i}`}
        className="ne-pick-in"
        type="radio"
        name={name}
        id={`${name}-${i}`}
        defaultChecked={i === 0}
      />
    ))}
    <div className="ne-tabs">
      {items.map((item, i) => (
        <label key={`tab-${i}`} className="ne-tab" htmlFor={`${name}-${i}`}>
          {item.tab}
        </label>
      ))}
    </div>
    <div className="ne-panels">
      {items.map((item, i) => (
        <div key={`panel-${i}`} className="ne-panel">
          <div className={`ne-lead ne-${item.tone || "plain"}`}>
            {item.tone ? <span className="ne-sym">{neSymbol(item.tone)}</span> : null}
            {item.lead}
          </div>
          {(item.why || []).map((line, j) => (
            <p key={`why-${j}`} className="ne-why">
              {line}
            </p>
          ))}
        </div>
      ))}
    </div>
    {note ? <div className="ne-ft">{note}</div> : null}
  </div>
);

/**
 * 判定折叠：勾掉一条断言或打开 --strict，看整条评估用例的判定怎么变。
 * rows[i] = { sev: "gate" | "soft", name, note, strictNote?, fixed?: true }
 * fixed 的行没有开关——无线的 soft 永远不会 failed，给它一个开关是在撒谎。
 * 判定与四条理由由 widgets.css 的 :has() 规则选，组件把四种可能都渲染出来。
 */
export const Verdict = ({ title, hint, note, rows = [] }) => (
  <div className="ne-w ne-vd">
    <div className="ne-hd">
      {title}
      {hint ? <span className="ne-hd-hint">{hint}</span> : null}
    </div>
    <div className="ne-rows">
      {rows.map((row, i) =>
        row.fixed ? (
          <div key={`row-${i}`} className="ne-row ne-row-fixed">
            <span className="ne-box-gap" />
            <span className="ne-sev">{row.sev}</span>
            <span className="ne-mono">{row.name}</span>
            <span className="ne-note">{row.note}</span>
          </div>
        ) : (
          <label key={`row-${i}`} className="ne-row">
            <input type="checkbox" className={`ne-a ne-a-${row.sev}`} defaultChecked />
            <span className="ne-sev">{row.sev}</span>
            <span className="ne-mono">{row.name}</span>
            <span className="ne-note">
              {row.strictNote ? <span className="ne-not-strict">{row.note}</span> : row.note}
              {row.strictNote ? <span className="ne-only-strict">{row.strictNote}</span> : null}
            </span>
          </label>
        ),
      )}
    </div>
    <label className="ne-row ne-row-strict">
      <input type="checkbox" className="ne-strict" />
      <span>
        跑的时候加上 <code>--strict</code>
      </span>
    </label>
    <div className="ne-panel">
      <span className="ne-lead ne-vd-passed ne-pos">
        <span className="ne-sym">✓</span>passed
      </span>
      <span className="ne-lead ne-vd-failed ne-neg">
        <span className="ne-sym">✗</span>failed
      </span>
      <p className="ne-why ne-vd-say ne-vd-say-ok">全部 gate 通过，soft 也都达标。</p>
      <p className="ne-why ne-vd-say ne-vd-say-gate">
        有 gate 没通过。gate 是硬要求，一条不过整条 Attempt 就是 failed。
      </p>
      <p className="ne-why ne-vd-say ne-vd-say-soft">
        soft 那条没到线，如实记了一条不达标的断言，但判定不受影响——质量分低不等于任务失败。
      </p>
      <p className="ne-why ne-vd-say ne-vd-say-strict">
        带线的 soft 在 <code>--strict</code> 下和 gate 同权，所以判定翻成 failed。分数照记，不因为 strict 改变。
      </p>
    </div>
    {note ? <div className="ne-ft">{note}</div> : null}
  </div>
);

/**
 * 生命周期：一条 Attempt 从排队到收尾逐段点亮。
 * phases[i] = { name, what, times }；每行的动画延迟按下标算，周期随行数走。
 */
export const Lifecycle = ({ title, hint, note, phases = [] }) => (
  <div className="ne-w ne-life">
    <div className="ne-hd">
      {title}
      {hint ? <span className="ne-hd-hint">{hint}</span> : null}
    </div>
    <div className="ne-rows">
      {phases.map((phase, i) => (
        <div key={`ph-${i}`} className="ne-life-row">
          <span
            className="ne-life-bar"
            style={{ animationDelay: `${i * 2}s`, animationDuration: `${phases.length * 2}s` }}
          />
          <span className="ne-life-name">{phase.name}</span>
          <span className="ne-life-what">{phase.what}</span>
          <span className="ne-life-times">{phase.times}</span>
        </div>
      ))}
    </div>
    {note ? <div className="ne-ft">{note}</div> : null}
  </div>
);

/**
 * 调度：全局并发位与实验自己的上限怎么一起决定谁在跑。
 * lanes[i] = { label, bars: [{ text, from, to, tone?: "serial" | "backoff" }] }
 * from / to 是 1..span 的时间刻度；legend[i] = { tone?, text }。
 */
export const Schedule = ({ title, hint, note, span = 12, lanes = [], legend = [] }) => (
  <div className="ne-w">
    <div className="ne-hd">
      {title}
      {hint ? <span className="ne-hd-hint">{hint}</span> : null}
    </div>
    <div className="ne-sched">
      <div className="ne-sched-lanes">
        {lanes.map((lane, i) => (
          <div
            key={`lane-${i}`}
            className="ne-sched-lane"
            style={{ gridTemplateColumns: `92px repeat(${span}, minmax(18px, 1fr))` }}
          >
            <div className="ne-sched-label">{lane.label}</div>
            <div className="ne-sched-track" />
            {(lane.bars || []).map((bar, j) => (
              <div
                key={`bar-${j}`}
                className={bar.tone ? `ne-sched-bar ne-sched-${bar.tone}` : "ne-sched-bar"}
                style={{ gridColumn: `${bar.from + 1} / ${bar.to + 1}` }}
              >
                {bar.text}
              </div>
            ))}
          </div>
        ))}
        <div className="ne-sched-play" />
      </div>
      <div className="ne-sched-axis">时间 →</div>
    </div>
    {legend.length ? (
      <div className="ne-legend">
        {legend.map((item, i) => (
          <span key={`lg-${i}`}>
            <span className={item.tone ? `ne-legend-key ne-sched-${item.tone}` : "ne-legend-key"} />
            {item.text}
          </span>
        ))}
      </div>
    ) : null}
    {note ? <div className="ne-ft">{note}</div> : null}
  </div>
);
