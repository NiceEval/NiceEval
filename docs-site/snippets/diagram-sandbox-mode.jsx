/*
 * 图：Sandbox 模式的接入形状。一图一个组件，内容写死在组件里——图讲的是哪件事是
 * 组件的一部分，页面不用传一份数据把画面拼出来。共用样式在 docs-site/diagrams.css。
 *
 * 写法约束同 snippets/widgets.jsx：只写箭头函数、不写 import（Mintlify 不允许
 * snippet 之间互相 import）、模块作用域里不放未导出的变量。动画走 CSS，关掉
 * JavaScript 也照常可读。
 */
export const SandboxMode = () => (
  <div className="ne-w ne-flow">
    <div className="ne-hd">
      Sandbox 模式
      <span className="ne-hd-hint">被测对象需要一个能改文件、跑命令的工作区</span>
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
        <div className="ne-flow-sub">发现评估用例、排期、判定、出报告</div>
      </div>

      <div className="ne-flow-edge">
        <span className="ne-flow-line ne-lit" style={{ animationDelay: "1.8s" }} />
        <span className="ne-flow-edge-text">Agent 适配器（官方）</span>
        <span className="ne-flow-line ne-lit" style={{ animationDelay: "2.1s" }} />
        <span className="ne-flow-tip">▼</span>
      </div>

      <div className="ne-flow-node ne-lit" style={{ animationDelay: "2.4s" }}>
        <div className="ne-flow-name">Docker Sandbox</div>
        <div className="ne-flow-sub">每个 Attempt 一个干净工作区</div>
        <div className="ne-flow-inner ne-lit" style={{ animationDelay: "3s" }}>
          <div className="ne-flow-name">Codex / Claude Code</div>
          <div className="ne-flow-sub">需要隔离工作区的应用</div>
        </div>
      </div>
    </div>
    <div className="ne-ft">Fixture 写进这个工作区，跑完在里面收文件与命令结果。</div>
  </div>
);
