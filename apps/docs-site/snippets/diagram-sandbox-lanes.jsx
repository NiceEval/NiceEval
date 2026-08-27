/*
 * 图：开了 sandboxReuse 之后，两条 Sandbox 泳道各自依次承接多条 Attempt，
 * Sandbox 创建每条泳道只付一次，每条 Attempt 仍执行 before/after，题间回滚工作目录。
 * 一图一个组件，内容写死在组件里。样式在 styles/diagram-sandbox-lanes.css。
 *
 * 写法约束同 snippets/widgets.jsx：只写箭头函数、不写 import、模块作用域里不放未导出的
 * 变量。12 格 = 12 秒，所以每段的 animationDelay 就是它的起始格减一。
 */
export const SandboxLanes = () => (
  <div className="ne-w ne-sbx">
    <div className="ne-hd">
      一条泳道上的两条 Attempt
      <span className="ne-hd-hint">maxConcurrency: 2 · sandboxReuse: true</span>
    </div>

    <div className="ne-sbx-body">
      <div className="ne-sbx-lane">
        <div className="ne-sbx-label">Sandbox #1</div>
        <div className="ne-sbx-track" />
        <div className="ne-sbx-seg ne-sbx-once ne-lit" style={{ gridColumn: "2 / 3", animationDelay: "0s" }}>
          创建
        </div>
        <div className="ne-sbx-seg ne-lit" style={{ gridColumn: "3 / 8", animationDelay: "1s" }}>
          before · range · after
        </div>
        <div className="ne-sbx-seg ne-sbx-reset ne-lit" style={{ gridColumn: "8 / 9", animationDelay: "6s" }}>
          重置
        </div>
        <div className="ne-sbx-seg ne-lit" style={{ gridColumn: "9 / 12", animationDelay: "7s" }}>
          before · locale · after
        </div>
        <div className="ne-sbx-seg ne-sbx-once ne-lit" style={{ gridColumn: "12 / 13", animationDelay: "10s" }}>
          停止
        </div>
      </div>

      <div className="ne-sbx-lane">
        <div className="ne-sbx-label">Sandbox #2</div>
        <div className="ne-sbx-track" />
        <div className="ne-sbx-seg ne-sbx-once ne-lit" style={{ gridColumn: "2 / 3", animationDelay: "0s" }}>
          创建
        </div>
        <div className="ne-sbx-seg ne-lit" style={{ gridColumn: "3 / 9", animationDelay: "1s" }}>
          before · keyboard · after
        </div>
        <div className="ne-sbx-seg ne-sbx-reset ne-lit" style={{ gridColumn: "9 / 10", animationDelay: "7s" }}>
          重置
        </div>
        <div className="ne-sbx-seg ne-lit" style={{ gridColumn: "10 / 13", animationDelay: "8s" }}>
          before · timezone · after
        </div>
      </div>

      <div className="ne-sbx-play" />
      <div className="ne-sbx-axis">时间 →</div>
    </div>

    <div className="ne-sbx-legend">
      <div className="ne-sbx-item">
        <span className="ne-sbx-key ne-sbx-once" />
        每个 Sandbox 一次：创建、停止
      </div>
      <div className="ne-sbx-item">
        <span className="ne-sbx-key" />
        每条 Attempt 一次：Sandbox <code>before</code> / <code>after</code>、Agent 与评估用例生命周期、<code>test(t)</code>
      </div>
      <div className="ne-sbx-item">
        <span className="ne-sbx-key ne-sbx-reset" />
        题间重置：<code>git reset --hard</code> + <code>git clean</code>，只回滚工作目录
      </div>
    </div>

    <div className="ne-ft">
      <code>$HOME</code>、<code>/tmp</code>、全局安装和后台进程活过重置点，所以准备代码要能重放；做不到就别开复用，用并发。
    </div>
  </div>
);
