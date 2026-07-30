/*
 * 图：一次 t.send 的完整往返。去程三段依次点亮，再回程三段依次点亮。
 * 一图一个组件，内容写死在组件里。共用样式在 docs-site/diagrams.css，
 * 写法约束见 snippets/diagram-sandbox-mode.jsx 开头。
 */
export const TurnRoundtrip = () => (
  <div className="ne-w ne-rt">
    <div className="ne-hd">
      一次 t.send 的完整往返
      <span className="ne-hd-hint">
        <span className="ne-mono">▸</span> 去程 · <span className="ne-mono">◂</span> 回程
      </span>
    </div>
    <div className="ne-rt-scroll">
      <div className="ne-rt-grid">
        <div className="ne-rt-head" style={{ gridColumn: 1, gridRow: 1 }}>
          evals/*.eval.ts
        </div>
        <div className="ne-rt-head" style={{ gridColumn: 3, gridRow: 1 }}>
          NiceEval
        </div>
        <div className="ne-rt-head" style={{ gridColumn: 5, gridRow: 1 }}>
          Adapter（你写）
        </div>

        <div className="ne-rt-aside" style={{ gridColumn: 7, gridRow: "1 / 5" }}>
          <div className="ne-rt-aside-name">你的应用</div>
          <div className="ne-rt-aside-line">前端在用的接口</div>
          <div className="ne-rt-aside-line">响应 / SSE 流</div>
          <div className="ne-rt-aside-line">一行不改</div>
        </div>

        <div className="ne-rt-cell" style={{ gridColumn: 1, gridRow: 2 }}>
          await t.send("...")
        </div>
        <span className="ne-rt-arrow ne-lit" style={{ gridColumn: 2, gridRow: 2, animationDelay: "0.3s" }}>
          ▸
        </span>
        <div className="ne-rt-cell" style={{ gridColumn: 3, gridRow: 2 }}>
          组装 TurnInput + ctx
        </div>
        <span className="ne-rt-arrow ne-lit" style={{ gridColumn: 4, gridRow: 2, animationDelay: "0.9s" }}>
          ▸
        </span>
        <div className="ne-rt-cell" style={{ gridColumn: 5, gridRow: 2 }}>
          send(input, ctx)
        </div>
        <span className="ne-rt-arrow ne-lit" style={{ gridColumn: 6, gridRow: 2, animationDelay: "1.5s" }}>
          ▸
        </span>

        <div className="ne-rt-cell" style={{ gridColumn: 1, gridRow: 3 }}>
          t.reply
        </div>
        <span className="ne-rt-arrow ne-rt-back ne-lit" style={{ gridColumn: 2, gridRow: 3, animationDelay: "3.6s" }}>
          ◂
        </span>
        <div className="ne-rt-cell" style={{ gridColumn: 3, gridRow: 3 }}>
          折叠 events 成事实
        </div>
        <span className="ne-rt-arrow ne-rt-back ne-lit" style={{ gridColumn: 4, gridRow: 3, animationDelay: "3s" }}>
          ◂
        </span>
        <div className="ne-rt-cell" style={{ gridColumn: 5, gridRow: 3 }}>
          翻译成 events
        </div>
        <span className="ne-rt-arrow ne-rt-back ne-lit" style={{ gridColumn: 6, gridRow: 3, animationDelay: "2.4s" }}>
          ◂
        </span>

        <div className="ne-rt-cell" style={{ gridColumn: 1, gridRow: 4 }}>
          t.calledTool()...
        </div>
        <div className="ne-rt-cell" style={{ gridColumn: 3, gridRow: 4 }}>
          更新 t.reply 与用量
        </div>
        <div className="ne-rt-cell" style={{ gridColumn: 5, gridRow: 4 }}>
          return Turn
        </div>
      </div>
    </div>
    <div className="ne-rt-pills">
      <span className="ne-pill">t.send</span>
      <span className="ne-pill">t.sendFile</span>
      <span className="ne-pill">t.respond</span>
      <span className="ne-rt-pillnote">都是运行器侧的统一事件入口；adapter 只实现 send。</span>
    </div>
  </div>
);
