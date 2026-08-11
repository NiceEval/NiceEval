/*
 * 图：OTel span 怎么被收上来、怎么归一，以及它和断言那条路的关系。
 * 两条轨各走各的：上面一条决定判定，下面一条只决定瀑布图。
 * 一图一个组件，内容写死在组件里。共用样式在 docs-site/diagrams.css，
 * 写法约束见 snippets/diagram-sandbox-mode.jsx 开头。
 */
export const OtelCollect = () => (
  <div className="ne-w ne-trk">
    <div className="ne-hd">
      一轮里的两条数据
      <span className="ne-hd-hint">事件流决定判定，span 只决定瀑布图</span>
    </div>

    <div className="ne-trk-seed">
      <span className="ne-pill">ctx.telemetry.headers</span>
      <span className="ne-trk-sub">
        send 发请求时 spread 进请求头：本轮 span 挂到 NiceEval 给的 traceId 下，并发跑也不串轮。
      </span>
    </div>

    <div className="ne-trk-track">
      <div className="ne-trk-label">
        事件流
        <span className="ne-trk-lead">断言只读这一条</span>
      </div>
      <div className="ne-trk-stages">
        <div className="ne-trk-stage">
          <div className="ne-trk-box ne-lit" style={{ animationDelay: "0s" }}>
            <div className="ne-trk-text">应用返回</div>
            <div className="ne-trk-sub">响应 / SSE 流</div>
          </div>
        </div>
        <div className="ne-trk-stage">
          <span className="ne-trk-step ne-lit" style={{ animationDelay: "0.3s" }}>▸</span>
          <div className="ne-trk-box ne-lit" style={{ animationDelay: "0.6s" }}>
            <div className="ne-trk-text">adapter 翻译</div>
            <div className="ne-trk-sub">你写的映射</div>
          </div>
        </div>
        <div className="ne-trk-stage">
          <span className="ne-trk-step ne-lit" style={{ animationDelay: "0.9s" }}>▸</span>
          <div className="ne-trk-box ne-lit" style={{ animationDelay: "1.2s" }}>
            <div className="ne-trk-text">Turn.events + usage</div>
            <div className="ne-trk-sub">标准事件流</div>
          </div>
        </div>
        <div className="ne-trk-stage">
          <span className="ne-trk-step ne-lit" style={{ animationDelay: "1.5s" }}>▸</span>
          <div className="ne-trk-box ne-lit" style={{ animationDelay: "1.8s" }}>
            <div className="ne-trk-text">t.calledTool / t.maxTokens</div>
            <div className="ne-trk-sub">判定在这里产生</div>
          </div>
        </div>
      </div>
    </div>

    <div className="ne-trk-track">
      <div className="ne-trk-label">
        OTel span
        <span className="ne-trk-lead">画图用，不进事件流、不参与判定</span>
      </div>
      <div className="ne-trk-stages">
        <div className="ne-trk-stage">
          <div className="ne-trk-box ne-lit" style={{ animationDelay: "2.6s" }}>
            <div className="ne-trk-text">应用已有的埋点</div>
            <div className="ne-trk-sub">AI SDK / LangSmith / OpenLLMetry / 自己埋的 gen_ai</div>
          </div>
        </div>
        <div className="ne-trk-stage">
          <span className="ne-trk-step ne-lit" style={{ animationDelay: "2.9s" }}>▸</span>
          <div className="ne-trk-box ne-lit" style={{ animationDelay: "3.2s" }}>
            <div className="ne-trk-text">OTLP 接收器</div>
            <div className="ne-trk-sub">宿主固定端口，或 Sandbox 内临时端口</div>
          </div>
        </div>
        <div className="ne-trk-stage">
          <span className="ne-trk-step ne-lit" style={{ animationDelay: "3.5s" }}>▸</span>
          <div className="ne-trk-box ne-lit" style={{ animationDelay: "3.8s" }}>
            <div className="ne-trk-text">归属到本轮</div>
            <div className="ne-trk-sub">按 traceparent 的 traceId，兜底按时间窗</div>
          </div>
        </div>
        <div className="ne-trk-stage">
          <span className="ne-trk-step ne-lit" style={{ animationDelay: "4.1s" }}>▸</span>
          <div className="ne-trk-box ne-lit" style={{ animationDelay: "4.4s" }}>
            <div className="ne-trk-text">归一成 GenAI 语义</div>
            <div className="ne-trk-sub">chat / execute_tool、耗时与 token</div>
          </div>
        </div>
        <div className="ne-trk-stage">
          <span className="ne-trk-step ne-lit" style={{ animationDelay: "4.7s" }}>▸</span>
          <div className="ne-trk-box ne-lit" style={{ animationDelay: "5s" }}>
            <div className="ne-trk-text">trace Projection</div>
            <div className="ne-trk-sub">niceeval view 的调用瀑布图</div>
          </div>
        </div>
      </div>
    </div>

    <div className="ne-ft">
      两条轨不交叉：埋点缺失、span 迟到或丢批只让瀑布图不完整，判定仍以 send 返回的 events 与 usage 为准。
    </div>
  </div>
);
