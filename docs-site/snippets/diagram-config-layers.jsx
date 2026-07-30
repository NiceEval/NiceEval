/*
 * 图：同一个 timeoutMs 写在不同层时，最终生效的是谁。
 * 一图一个组件，内容写死在组件里。切面板的机制与 Picker 共用（styles/tabs.css），
 * 这张图自己的样式在 styles/diagram-config-layers.css。
 *
 * 写法约束同 snippets/widgets.jsx：只写箭头函数、不写 import、模块作用域里不放未导出的
 * 变量。四种写法各自把五层完整画出来，选哪种就显示哪一份，不用脚本算。
 */
export const ConfigLayers = () => (
  <div className="ne-w ne-cfg">
    <div className="ne-hd">
      timeoutMs 写在哪一层
      <span className="ne-hd-hint">选一种写法，看最终生效的是谁</span>
    </div>

    <input className="ne-pick-in" type="radio" name="ne-cfg-layers" id="ne-cfg-0" defaultChecked />
    <input className="ne-pick-in" type="radio" name="ne-cfg-layers" id="ne-cfg-1" />
    <input className="ne-pick-in" type="radio" name="ne-cfg-layers" id="ne-cfg-2" />
    <input className="ne-pick-in" type="radio" name="ne-cfg-layers" id="ne-cfg-3" />

    <div className="ne-tabs">
      <label className="ne-tab" htmlFor="ne-cfg-0">
        只写 config
      </label>
      <label className="ne-tab" htmlFor="ne-cfg-1">
        这道题自己声明
      </label>
      <label className="ne-tab" htmlFor="ne-cfg-2">
        实验压过它
      </label>
      <label className="ne-tab" htmlFor="ne-cfg-3">
        这一次再压一遍
      </label>
    </div>

    <div className="ne-panels">
      <div className="ne-panel ne-cfg-panel">
        <div className="ne-cfg-row">
          <span className="ne-cfg-layer">CLI flag</span>
          <span className="ne-cfg-src">--timeout</span>
          <span className="ne-cfg-val ne-dim">未写</span>
          <span className="ne-cfg-mark ne-dim">—</span>
        </div>
        <div className="ne-cfg-row">
          <span className="ne-cfg-layer">experiment</span>
          <span className="ne-cfg-src">experiments/ci.ts</span>
          <span className="ne-cfg-val ne-dim">未写</span>
          <span className="ne-cfg-mark ne-dim">—</span>
        </div>
        <div className="ne-cfg-row">
          <span className="ne-cfg-layer">eval</span>
          <span className="ne-cfg-src">defineEval</span>
          <span className="ne-cfg-val ne-dim">未写</span>
          <span className="ne-cfg-mark ne-dim">—</span>
        </div>
        <div className="ne-cfg-row ne-cfg-win">
          <span className="ne-cfg-layer">config</span>
          <span className="ne-cfg-src">niceeval.config.ts</span>
          <span className="ne-cfg-val">300_000</span>
          <span className="ne-cfg-mark">✓ 生效</span>
        </div>
        <div className="ne-cfg-row ne-cfg-under">
          <span className="ne-cfg-layer">内置默认</span>
          <span className="ne-cfg-src">NiceEval</span>
          <span className="ne-cfg-val">无上限</span>
          <span className="ne-cfg-mark">被上层盖住</span>
        </div>
        <p className="ne-why">整个项目共享的值写这里，没有别的层声明时每道题都按它跑。</p>
      </div>

      <div className="ne-panel ne-cfg-panel">
        <div className="ne-cfg-row">
          <span className="ne-cfg-layer">CLI flag</span>
          <span className="ne-cfg-src">--timeout</span>
          <span className="ne-cfg-val ne-dim">未写</span>
          <span className="ne-cfg-mark ne-dim">—</span>
        </div>
        <div className="ne-cfg-row">
          <span className="ne-cfg-layer">experiment</span>
          <span className="ne-cfg-src">experiments/ci.ts</span>
          <span className="ne-cfg-val ne-dim">未写</span>
          <span className="ne-cfg-mark ne-dim">—</span>
        </div>
        <div className="ne-cfg-row ne-cfg-win">
          <span className="ne-cfg-layer">eval</span>
          <span className="ne-cfg-src">defineEval</span>
          <span className="ne-cfg-val">2_100_000</span>
          <span className="ne-cfg-mark">✓ 生效</span>
        </div>
        <div className="ne-cfg-row ne-cfg-under">
          <span className="ne-cfg-layer">config</span>
          <span className="ne-cfg-src">niceeval.config.ts</span>
          <span className="ne-cfg-val">300_000</span>
          <span className="ne-cfg-mark">被上层盖住</span>
        </div>
        <div className="ne-cfg-row ne-cfg-under">
          <span className="ne-cfg-layer">内置默认</span>
          <span className="ne-cfg-src">NiceEval</span>
          <span className="ne-cfg-val">无上限</span>
          <span className="ne-cfg-mark">被上层盖住</span>
        </div>
        <p className="ne-why">
          config 是默认来源，不是覆盖层：一道要装 35 分钟环境的题自己声明了上限，在写着 5 分钟的项目里仍按 35 分钟跑。
        </p>
      </div>

      <div className="ne-panel ne-cfg-panel">
        <div className="ne-cfg-row">
          <span className="ne-cfg-layer">CLI flag</span>
          <span className="ne-cfg-src">--timeout</span>
          <span className="ne-cfg-val ne-dim">未写</span>
          <span className="ne-cfg-mark ne-dim">—</span>
        </div>
        <div className="ne-cfg-row ne-cfg-win">
          <span className="ne-cfg-layer">experiment</span>
          <span className="ne-cfg-src">experiments/ci.ts</span>
          <span className="ne-cfg-val">600_000</span>
          <span className="ne-cfg-mark">✓ 生效</span>
        </div>
        <div className="ne-cfg-row ne-cfg-under">
          <span className="ne-cfg-layer">eval</span>
          <span className="ne-cfg-src">defineEval</span>
          <span className="ne-cfg-val">2_100_000</span>
          <span className="ne-cfg-mark">被上层盖住</span>
        </div>
        <div className="ne-cfg-row ne-cfg-under">
          <span className="ne-cfg-layer">config</span>
          <span className="ne-cfg-src">niceeval.config.ts</span>
          <span className="ne-cfg-val">300_000</span>
          <span className="ne-cfg-mark">被上层盖住</span>
        </div>
        <div className="ne-cfg-row ne-cfg-under">
          <span className="ne-cfg-layer">内置默认</span>
          <span className="ne-cfg-src">NiceEval</span>
          <span className="ne-cfg-val">无上限</span>
          <span className="ne-cfg-mark">被上层盖住</span>
        </div>
        <p className="ne-why">
          要整批压短，用 experiment 显式写一个值——只有显式声明能压过题目自己的声明，config 的默认值不行。
        </p>
      </div>

      <div className="ne-panel ne-cfg-panel">
        <div className="ne-cfg-row ne-cfg-win">
          <span className="ne-cfg-layer">CLI flag</span>
          <span className="ne-cfg-src">--timeout 900000</span>
          <span className="ne-cfg-val">900_000</span>
          <span className="ne-cfg-mark">✓ 生效</span>
        </div>
        <div className="ne-cfg-row ne-cfg-under">
          <span className="ne-cfg-layer">experiment</span>
          <span className="ne-cfg-src">experiments/ci.ts</span>
          <span className="ne-cfg-val">600_000</span>
          <span className="ne-cfg-mark">被上层盖住</span>
        </div>
        <div className="ne-cfg-row ne-cfg-under">
          <span className="ne-cfg-layer">eval</span>
          <span className="ne-cfg-src">defineEval</span>
          <span className="ne-cfg-val">2_100_000</span>
          <span className="ne-cfg-mark">被上层盖住</span>
        </div>
        <div className="ne-cfg-row ne-cfg-under">
          <span className="ne-cfg-layer">config</span>
          <span className="ne-cfg-src">niceeval.config.ts</span>
          <span className="ne-cfg-val">300_000</span>
          <span className="ne-cfg-mark">被上层盖住</span>
        </div>
        <div className="ne-cfg-row ne-cfg-under">
          <span className="ne-cfg-layer">内置默认</span>
          <span className="ne-cfg-src">NiceEval</span>
          <span className="ne-cfg-val">无上限</span>
          <span className="ne-cfg-mark">被上层盖住</span>
        </div>
        <p className="ne-why">只想这一次不一样就写在命令上，下一次不带它就回到 experiment 的值。</p>
      </div>
    </div>

    <div className="ne-ft">
      顺序固定：CLI flag → experiment → eval → config → 内置默认，前面有值就不看后面。
      <code>agent</code>、<code>model</code>、<code>flags</code> 只有 experiment 那一层。
    </div>
  </div>
);
