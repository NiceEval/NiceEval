/*
 * 图：Record 的磁盘分层。portable Record 内只有 Core、owner-local
 * RecordAttachment 与最后建立的 complete；未完成目录和 local operation state
 * 在图上明确放到它的边界之外。
 * 一图一个组件，内容写死在组件里；样式在 styles/diagram-record-shape.css。
 *
 * 写法约束同 snippets/widgets.jsx：只写箭头函数、不写 import、模块作用域里
 * 不放未导出的变量。动画只靠 CSS，悬停暂停，reduced motion 时停止。
 */
export const RecordShape = () => (
  <div className="ne-w ne-rec">
    <div className="ne-hd">
      Record 的磁盘分层
      <span className="ne-hd-hint">完整 Run 才是可携带的事实</span>
    </div>

    <div className="ne-rec-layout">
      <section className="ne-rec-portable">
        <div className="ne-rec-boundary ne-lit" style={{ animationDelay: "0s" }}>
          <span>portable Record</span>
          <span className="ne-rec-boundary-note">可复制 · 可进 Git</span>
        </div>

        <div className="ne-rec-root ne-lit" style={{ animationDelay: "0.15s" }}>
          <code>record.json</code>
          <span>format · recordId</span>
        </div>

        <div className="ne-rec-run">
          <div className="ne-rec-run-head ne-lit" style={{ animationDelay: "0.3s" }}>
            <code>runs/&lt;RunId&gt;/</code>
            <span>一个已发布的 Run</span>
          </div>

          <div className="ne-rec-core">
            <div className="ne-rec-group-head">Record Core 骨架</div>
            <div className="ne-rec-row ne-lit" style={{ animationDelay: "0.45s" }}>
              <code>run.json</code>
              <span>expectedSlots · completedAt</span>
            </div>
            <div className="ne-rec-row ne-lit" style={{ animationDelay: "0.6s" }}>
              <code>members/&lt;SlotId&gt;.json</code>
              <span>精确指向一个 Attempt</span>
            </div>
            <div className="ne-rec-row ne-lit" style={{ animationDelay: "0.75s" }}>
              <code>attempts/&lt;AttemptId&gt;/attempt.json</code>
              <span>origin Run</span>
            </div>
          </div>

          <div className="ne-rec-attachments">
            <div className="ne-rec-attachment ne-lit" style={{ animationDelay: "1.1s" }}>
              <div className="ne-rec-group-head">Run-owned RecordAttachment</div>
              <code>attachments/&lt;name&gt;/</code>
              <span>attachment.json · payload.json · blobs/**</span>
              <small>例如 Evaluations、Membership provenance、Sources</small>
            </div>
            <div className="ne-rec-attachment ne-lit" style={{ animationDelay: "1.35s" }}>
              <div className="ne-rec-group-head">Attempt-owned RecordAttachment</div>
              <code>attempts/&lt;AttemptId&gt;/attachments/&lt;name&gt;/</code>
              <span>attachment.json · payload.json · blobs/**</span>
              <small>例如 Assertions、Verdict、Score、Eligibility</small>
            </div>
          </div>

          <div className="ne-rec-last ne-lit" style={{ animationDelay: "1.65s" }}>
            <span className="ne-rec-last-arrow">所有 Core 与 Attachment 写完</span>
            <code>complete</code>
            <span>最后创建的零字节发布标识</span>
          </div>
        </div>
      </section>

      <aside className="ne-rec-aside">
        <section className="ne-rec-incomplete">
          <div className="ne-rec-aside-head ne-lit" style={{ animationDelay: "2.1s" }}>
            写入中的 Run 目录
          </div>
          <code>runs/&lt;RunId&gt;/</code>
          <strong>没有 <code>complete</code></strong>
          <p className="ne-why">
            它可能留在磁盘上，但还不是 Record 事实。reader 忽略它并给出
            <code>incomplete-run</code> warning。
          </p>
        </section>

        <section className="ne-rec-local">
          <div className="ne-rec-aside-head ne-lit" style={{ animationDelay: "2.4s" }}>
            local operation state
          </div>
          <code>.niceeval-local/</code>
          <span>session · maintenance / writer lock · cache</span>
          <p className="ne-why">
            它在 portable Record 外。复制或分享 Record 时不带上这些状态。
          </p>
        </section>
      </aside>
    </div>

    <div className="ne-ft">
      <code>complete</code> 出现后，writer 不再修改这个 Run；没有它的目录可由
      <code>niceeval clean</code> 清理。
    </div>
  </div>
);
