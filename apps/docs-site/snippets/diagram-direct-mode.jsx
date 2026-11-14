/*
 * 图：直连模式的接入形状。一图一个组件，内容写死在组件里。
 * 共用样式在 styles/diagram-access-modes.css，写法约束见 snippets/diagram-sandbox-mode.jsx 开头。
 */
export const DirectMode = ({ locale = "zh" }) => (
  <div className="ne-w ne-flow">
    <div className="ne-hd">
      {locale === "en" ? "Direct mode" : "直连模式"}
      <span className="ne-hd-hint">
        {locale === "en" ? "Use the same API your frontend already calls" : "对着前端本来就在用的那个接口收发"}
      </span>
    </div>
    <div className="ne-flow-body">
      <div className="ne-flow-plain ne-lit" style={{ animationDelay: "0s" }}>
        evals/*.eval.ts
      </div>

      <div className="ne-flow-edge">
        <span className="ne-flow-line ne-lit" style={{ animationDelay: "0.6s" }} />
        <span className="ne-flow-tip">▼</span>
      </div>

      <div className="ne-flow-node ne-lit" style={{ animationDelay: "1.2s" }}>
        <div className="ne-flow-name">niceeval</div>
        <div className="ne-flow-sub">
          {locale === "en" ? "Discover evals, schedule, score, and report" : "发现评估用例、排期、判定、出报告"}
        </div>
      </div>

      <div className="ne-flow-edge">
        <span className="ne-flow-line ne-lit" style={{ animationDelay: "1.8s" }} />
        <span className="ne-flow-edge-text">
          {locale === "en" ? "Agent Adapter (official or custom)" : "Agent 适配器（官方，或者自己实现）"}
        </span>
        <span className="ne-flow-line ne-lit" style={{ animationDelay: "2.1s" }} />
        <span className="ne-flow-tip">▼</span>
      </div>

      <div className="ne-flow-node ne-lit" style={{ animationDelay: "2.4s" }}>
        <div className="ne-flow-name">{locale === "en" ? "Your own AI Agent" : "你自己的 AI Agent"}</div>
        <div className="ne-flow-sub">
          {locale === "en"
            ? "AI SDK · LangGraph · Pi · custom Agent loop"
            : "AI SDK · LangGraph · Pi · 自研 agent loop 等"}
        </div>
      </div>
    </div>
    <div className="ne-ft">
      {locale === "en" ? "No Docker or application code changes required." : "不需要 Docker，应用代码一行不改。"}
    </div>
  </div>
);
