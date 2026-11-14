/*
 * 图：一次 t.send 的完整往返。去程三段依次点亮，再回程三段依次点亮。
 * 一图一个组件，内容写死在组件里。样式在 styles/diagram-turn-roundtrip.css，
 * 写法约束见 snippets/diagram-sandbox-mode.jsx 开头。
 */
export const TurnRoundtrip = ({ locale = "zh" }) => (
  <div className="ne-w ne-rt">
    <div className="ne-hd">
      {locale === "en" ? "A complete t.send round trip" : "一次 t.send 的完整往返"}
      <span className="ne-hd-hint">
        <span className="ne-mono">▸</span> {locale === "en" ? "Outbound ·" : "去程 ·"}{" "}
        <span className="ne-mono">◂</span> {locale === "en" ? "Inbound" : "回程"}
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
          {locale === "en" ? "Adapter (you write)" : "Adapter（你写）"}
        </div>

        <div className="ne-rt-aside ne-lit" style={{ gridColumn: 7, gridRow: "1 / 5", animationDelay: "1.5s" }}>
          <div className="ne-rt-aside-name">{locale === "en" ? "Your application" : "你的应用"}</div>
          <div className="ne-rt-aside-line">{locale === "en" ? "Your frontend's API" : "前端在用的接口"}</div>
          <div className="ne-rt-aside-line">{locale === "en" ? "Response / SSE stream" : "响应 / SSE 流"}</div>
          <div className="ne-rt-aside-line">{locale === "en" ? "No changes" : "一行不改"}</div>
        </div>

        <div className="ne-rt-cell ne-lit" style={{ gridColumn: 1, gridRow: 2, animationDelay: "0s" }}>
          await t.send("...")
        </div>
        <span className="ne-rt-arrow ne-lit" style={{ gridColumn: 2, gridRow: 2, animationDelay: "0.25s" }}>
          ▸
        </span>
        <div className="ne-rt-cell ne-lit" style={{ gridColumn: 3, gridRow: 2, animationDelay: "0.5s" }}>
          {locale === "en" ? "Build TurnInput + ctx" : "组装 TurnInput + ctx"}
        </div>
        <span className="ne-rt-arrow ne-lit" style={{ gridColumn: 4, gridRow: 2, animationDelay: "0.75s" }}>
          ▸
        </span>
        <div className="ne-rt-cell ne-lit" style={{ gridColumn: 5, gridRow: 2, animationDelay: "1s" }}>
          send(input, ctx)
        </div>
        <span className="ne-rt-arrow ne-lit" style={{ gridColumn: 6, gridRow: 2, animationDelay: "1.25s" }}>
          ▸
        </span>

        <div className="ne-rt-cell ne-lit" style={{ gridColumn: 1, gridRow: 3, animationDelay: "3.45s" }}>
          t.reply
        </div>
        <span className="ne-rt-arrow ne-rt-back ne-lit" style={{ gridColumn: 2, gridRow: 3, animationDelay: "3.2s" }}>
          ◂
        </span>
        <div className="ne-rt-cell ne-lit" style={{ gridColumn: 3, gridRow: 3, animationDelay: "2.95s" }}>
          {locale === "en" ? "Reduce events into facts" : "折叠 events 成事实"}
        </div>
        <span className="ne-rt-arrow ne-rt-back ne-lit" style={{ gridColumn: 4, gridRow: 3, animationDelay: "2.7s" }}>
          ◂
        </span>
        <div className="ne-rt-cell ne-lit" style={{ gridColumn: 5, gridRow: 3, animationDelay: "2.45s" }}>
          {locale === "en" ? "Translate into events" : "翻译成 events"}
        </div>
        <span className="ne-rt-arrow ne-rt-back ne-lit" style={{ gridColumn: 6, gridRow: 3, animationDelay: "2.2s" }}>
          ◂
        </span>

        <div className="ne-rt-cell ne-lit" style={{ gridColumn: 1, gridRow: 4, animationDelay: "3.9s" }}>
          t.calledTool()...
        </div>
        <div className="ne-rt-cell ne-lit" style={{ gridColumn: 3, gridRow: 4, animationDelay: "4.1s" }}>
          {locale === "en" ? "Update t.reply and usage" : "更新 t.reply 与用量"}
        </div>
        <div className="ne-rt-cell ne-lit" style={{ gridColumn: 5, gridRow: 4, animationDelay: "4.3s" }}>
          return Turn
        </div>
      </div>
    </div>
    <div className="ne-rt-pills">
      <span className="ne-pill">t.send</span>
      <span className="ne-pill">t.sendFile</span>
      <span className="ne-pill">t.respond</span>
      <span className="ne-rt-pillnote">
        {locale === "en"
          ? "These are unified event entry points on the runner side; the Adapter only implements send."
          : "都是运行器侧的统一事件入口；adapter 只实现 send。"}
      </span>
    </div>
  </div>
);
