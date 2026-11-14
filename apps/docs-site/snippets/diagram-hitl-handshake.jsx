/*
 * 图：HITL 一次完整握手。三条生命线，消息自上而下逐条点亮。
 * 一图一个组件，内容写死在组件里。样式在 styles/diagram-hitl-handshake.css，
 * 写法约束见 snippets/diagram-sandbox-mode.jsx 开头。
 */
export const HitlHandshake = ({ locale = "zh" }) => (
  <div className="ne-w ne-seq">
    <div className="ne-hd">
      {locale === "en" ? "A complete HITL handshake" : "HITL 一次完整握手"}
      <span className="ne-hd-hint">
        {locale === "en"
          ? "Pause, answer on the user's behalf, and resume the same turn"
          : "停一轮、替人答、同一轮接着跑"}
      </span>
    </div>
    <div className="ne-seq-scroll">
      <div className="ne-seq-grid">
        <span className="ne-seq-life" style={{ gridColumn: 1, gridRow: "1 / -1" }} />
        <span className="ne-seq-life" style={{ gridColumn: 2, gridRow: "1 / -1" }} />
        <span className="ne-seq-life" style={{ gridColumn: 3, gridRow: "1 / -1" }} />

        <div className="ne-seq-actor" style={{ gridColumn: 1, gridRow: 1 }}>
          test(t)
        </div>
        <div className="ne-seq-actor" style={{ gridColumn: 2, gridRow: 1 }}>
          {locale === "en" ? "Adapter send" : "Adapter 的 send"}
        </div>
        <div className="ne-seq-actor" style={{ gridColumn: 3, gridRow: 1 }}>
          {locale === "en" ? "Your application" : "你的应用"}
        </div>

        <div className="ne-seq-msg ne-lit" style={{ gridColumn: "1 / 3", gridRow: 2, animationDelay: "0s" }}>
          <div className="ne-seq-code">
            {locale === "en" ? 'await t.send("Deploy the service to prod")' : 'await t.send("把服务部署到 prod")'}
          </div>
          <div className="ne-seq-wire">
            <span className="ne-seq-line" />
            <span className="ne-seq-tip">▸</span>
          </div>
          <div className="ne-seq-note">{locale === "en" ? "First send" : "第 1 次 send"}</div>
        </div>

        <div className="ne-seq-msg ne-lit" style={{ gridColumn: "2 / 4", gridRow: 3, animationDelay: "1s" }}>
          <div className="ne-seq-code">{locale === "en" ? "Call the application" : "调应用"}</div>
          <div className="ne-seq-wire">
            <span className="ne-seq-line" />
            <span className="ne-seq-tip">▸</span>
          </div>
          <div className="ne-seq-note">
            {locale === "en" ? "Pause for deployment approval" : "停在部署确认上，等人批准"}
          </div>
        </div>

        <div
          className="ne-seq-msg ne-seq-back ne-lit"
          style={{ gridColumn: "1 / 3", gridRow: 4, animationDelay: "2s" }}
        >
          <div className="ne-seq-code">
            Turn&#123; status: "waiting", events: [..., input.requested(id: "req_1", options: approve | deny)] &#125;
            <span className="ne-seq-state ne-warn">
              <span className="ne-mono">!</span>
              {locale === "en" ? "Turn paused" : "停在这一轮"}
            </span>
          </div>
          <div className="ne-seq-wire">
            <span className="ne-seq-tip">◂</span>
            <span className="ne-seq-line" />
          </div>
        </div>

        <div className="ne-seq-local ne-lit" style={{ gridColumn: "1 / -1", gridRow: 5, animationDelay: "3s" }}>
          <span className="ne-pill">t.check(turn.status, equals("waiting"))</span>
          <span className="ne-seq-note">
            {locale === "en" ? "Assert that the turn paused" : "断言这一轮确实停下了"}
          </span>
        </div>

        <div className="ne-seq-local ne-lit" style={{ gridColumn: "1 / -1", gridRow: 6, animationDelay: "3.6s" }}>
          <span className="ne-pill">t.requireInputRequest(&#123; action: "deploy" &#125;)</span>
          <span className="ne-seq-note">
            {locale === "en" ? "Read pending requests without calling send" : "取出待答请求；只读结果，不触发 send"}
          </span>
        </div>

        <div className="ne-seq-msg ne-lit" style={{ gridColumn: "1 / 3", gridRow: 7, animationDelay: "4.2s" }}>
          <div className="ne-seq-code">await t.respond("approve")</div>
          <div className="ne-seq-wire">
            <span className="ne-seq-line" />
            <span className="ne-seq-tip">▸</span>
          </div>
          <div className="ne-seq-note">
            {locale === "en"
              ? 'Second send, another ordinary call: input.responses = [{ requestId: "req_1", optionId: "approve" }]'
              : '第 2 次 send，又一次普通 send：input.responses = [{ requestId: "req_1", optionId: "approve" }]'}
          </div>
        </div>

        <div className="ne-seq-msg ne-lit" style={{ gridColumn: "2 / 4", gridRow: 8, animationDelay: "5.2s" }}>
          <div className="ne-seq-code">
            {locale === "en" ? "Return the decision by requestId" : "按 requestId 交回裁决"}
          </div>
          <div className="ne-seq-wire">
            <span className="ne-seq-line" />
            <span className="ne-seq-tip">▸</span>
          </div>
          <div className="ne-seq-note">
            {locale === "en" ? "Resume the same turn without resending the request" : "同一轮接着跑，不重发请求"}
          </div>
        </div>

        <div
          className="ne-seq-msg ne-seq-back ne-lit"
          style={{ gridColumn: "1 / -1", gridRow: 9, animationDelay: "6.2s" }}
        >
          <div className="ne-seq-code">
            Turn&#123; status: "completed", events: [...] &#125;
            <span className="ne-seq-state ne-pos">
              <span className="ne-mono">✓</span>
              {locale === "en" ? "Turn complete" : "本轮结束"}
            </span>
          </div>
          <div className="ne-seq-wire">
            <span className="ne-seq-tip">◂</span>
            <span className="ne-seq-line" />
          </div>
        </div>

        <div className="ne-seq-local ne-lit" style={{ gridColumn: "1 / -1", gridRow: 10, animationDelay: "7.2s" }}>
          <span className="ne-pill">t.calledTool("deploy")</span>
          <span className="ne-seq-note">
            {locale === "en" ? "Events keep accumulating; assertions stay the same" : "事件流照常累计，断言词汇不变"}
          </span>
        </div>
      </div>
    </div>
  </div>
);
