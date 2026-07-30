/*
 * 图：接入等级三档，每档写清投入与买到。三档依次点亮，表达递进不互斥。
 * 一图一个组件，内容写死在组件里。共用样式在 docs-site/diagrams.css，
 * 写法约束见 snippets/diagram-sandbox-mode.jsx 开头。
 */
export const TierLadder = () => (
  <div className="ne-w ne-tier">
    <div className="ne-hd">
      接入等级
      <span className="ne-hd-hint">三档递进不互斥，已写的评估用例全程复用</span>
    </div>
    <div className="ne-tier-row">
      <div className="ne-tier-item">
        <div className="ne-tier-card ne-lit" style={{ animationDelay: "0s" }}>
          <div className="ne-tier-name">Tier 1 · 只接 send</div>
          <div className="ne-tier-kind">投入</div>
          <div className="ne-tier-line">一个 Adapter 文件</div>
          <div className="ne-tier-line">应用代码一行不改</div>
          <div className="ne-tier-kind">买到</div>
          <div className="ne-tier-line">文本断言、Judge、多轮、HITL</div>
          <div className="ne-tier-line">手写映射的工具断言、模型对比</div>
        </div>
      </div>

      <div className="ne-tier-item">
        <span className="ne-tier-step ne-lit" style={{ animationDelay: "1.4s" }}>
          ▸
        </span>
        <div className="ne-tier-card ne-lit" style={{ animationDelay: "1.6s" }}>
          <div className="ne-tier-name">Tier 2 · send + OTel</div>
          <div className="ne-tier-kind">投入</div>
          <div className="ne-tier-line">应用把 OTel span 发给 NiceEval 一份</div>
          <div className="ne-tier-line">已埋点的应用零改动</div>
          <div className="ne-tier-kind">买到</div>
          <div className="ne-tier-line">niceeval view 的调用瀑布图</div>
          <div className="ne-tier-line">每次模型 / 工具调用的耗时与 token</div>
        </div>
      </div>

      <div className="ne-tier-item">
        <span className="ne-tier-step ne-lit" style={{ animationDelay: "3s" }}>
          ▸
        </span>
        <div className="ne-tier-card ne-lit" style={{ animationDelay: "3.2s" }}>
          <div className="ne-tier-name">Tier 3 · 侵入改造</div>
          <div className="ne-tier-kind">投入</div>
          <div className="ne-tier-line">应用内部把变体暴露成</div>
          <div className="ne-tier-line">experiment 可传的 flags</div>
          <div className="ne-tier-kind">买到</div>
          <div className="ne-tier-line">prompt / 工具集 / feature</div>
          <div className="ne-tier-line">的 A/B 对比</div>
        </div>
      </div>
    </div>
    <div className="ne-ft">前两档无侵入：只对着前端本来就在用的接口收发。</div>
  </div>
);
