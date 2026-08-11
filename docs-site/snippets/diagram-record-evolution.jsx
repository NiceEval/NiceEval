/*
 * 图：持久格式的三条演进边界。作者 API / 算法变化停在行为层；
 * RecordAttachment 与 Record Core 都只能走相邻版本迁移。
 * 一图一个组件，内容写死在组件里；样式在 styles/diagram-record-evolution.css。
 *
 * 写法约束同 snippets/widgets.jsx：只写箭头函数、不写 import、模块作用域里
 * 不放未导出的变量。动画只靠 CSS，悬停暂停，reduced motion 时停止。
 */
export const RecordEvolution = () => (
  <div className="ne-w ne-ev">
    <div className="ne-hd">
      什么变化会改变磁盘
      <span className="ne-hd-hint">先找变化所属的层</span>
    </div>

    <div className="ne-ev-cases">
      <section className="ne-ev-case">
        <div className="ne-ev-case-head ne-lit" style={{ animationDelay: "0s" }}>
          作者 API、matcher 或算法
        </div>
        <div className="ne-ev-flow">
          <div className="ne-ev-node ne-lit" style={{ animationDelay: "0.15s" }}>
            API / 算法
          </div>
          <div className="ne-ev-arrow ne-lit" style={{ animationDelay: "0.3s" }}>
            改变行为
          </div>
          <div className="ne-ev-node ne-ev-stays ne-lit" style={{ animationDelay: "0.45s" }}>
            Record 磁盘不变
          </div>
        </div>
        <p className="ne-why">
          只要已保存事实的语义不变，作者调用方式和计算算法可以独立演进。
        </p>
      </section>

      <section className="ne-ev-case">
        <div className="ne-ev-case-head ne-lit" style={{ animationDelay: "1.1s" }}>
          RecordAttachment 的 payload
        </div>
        <div className="ne-ev-steps">
          <span className="ne-ev-version ne-lit" style={{ animationDelay: "1.25s" }}>
            attachment/v1
          </span>
          <span className="ne-ev-step ne-lit" style={{ animationDelay: "1.4s" }}>
            相邻迁移
          </span>
          <span className="ne-ev-version ne-lit" style={{ animationDelay: "1.55s" }}>
            attachment/v2
          </span>
          <span className="ne-ev-step ne-lit" style={{ animationDelay: "1.7s" }}>
            相邻迁移
          </span>
          <span className="ne-ev-version ne-lit" style={{ animationDelay: "1.85s" }}>
            attachment/v3
          </span>
        </div>
        <p className="ne-why">
          payload 的 shape 或语义改变时，每条边只连接相邻版本。不能无损迁移的边如实报告不可用。
        </p>
      </section>

      <section className="ne-ev-case">
        <div className="ne-ev-case-head ne-lit" style={{ animationDelay: "2.5s" }}>
          Record Core 的格式公理
        </div>
        <div className="ne-ev-steps">
          <span className="ne-ev-version ne-lit" style={{ animationDelay: "2.65s" }}>
            record/v1
          </span>
          <span className="ne-ev-step ne-lit" style={{ animationDelay: "2.8s" }}>
            相邻迁移
          </span>
          <span className="ne-ev-version ne-lit" style={{ animationDelay: "2.95s" }}>
            record/v2
          </span>
          <span className="ne-ev-step ne-lit" style={{ animationDelay: "3.1s" }}>
            相邻迁移
          </span>
          <span className="ne-ev-version ne-lit" style={{ animationDelay: "3.25s" }}>
            record/v3
          </span>
        </div>
        <p className="ne-why">
          只有 owner、引用、目录、完成判断或 Core shape 改变时，才提升 Core major。
        </p>
      </section>
    </div>

    <div className="ne-ft">
      <code>v1 → v3</code> 不跳步：Attachment 与 Core 都经由每一条相邻边前进。
    </div>
  </div>
);
