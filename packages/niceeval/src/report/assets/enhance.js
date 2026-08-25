// niceeval 报告的渐进增强 runtime:纯 vanilla JS、零依赖、IIFE、幂等。
// 只作用于 .niceeval-report DOM 与 data-niceeval-* 属性；包括 Tabs 单选切换、表格排序、
// 行过滤、SVG 点 tooltip、警告命令复制、源码语法着色与精确证据定位。全部只改浏览状态，
// 不改数据、指标口径或初始 HTML 数值。
// fragment 的初始 HTML 保留语义结构：排序有数据侧预排、tooltip 保留原生 <title>、
// Tabs 以原生 <details> 表达；app 挂载 fragment 后再增强浏览状态。
// 全部经 document 级事件委托绑定,重复注入本文件只在首次生效(window.__nreEnhanced 守卫),
// app 切换 fragment 并替换报告槽内容时也无需重新绑定。

(function () {
  "use strict";
  if (typeof window === "undefined" || window.__nreEnhanced) return;
  window.__nreEnhanced = true;

  // 根类 niceeval-js:styles.css 用它把仅增强态的布局(单选 tab 条、复制指针)限定在 JS 在场时。
  // 挂在 documentElement 上与报告块位置无关,块之后被搬进槽位也不需要补标记。
  document.documentElement.classList.add("niceeval-js");

  function closest(target, selector) {
    return target && target.closest ? target.closest(selector) : null;
  }

  // ───────────────────────── SourceView:客户端语法着色 ─────────────────────────
  // 静态 HTML 只保留完整、已转义的源码文本，避免全站构建为每个 token、每种 locale
  // 预先创建 React 节点。浏览器只给当前打开的 fragment 着色，源码文本始终保留。
  // MutationObserver 覆盖 attempt 文档被 Host modal 插入后的同一行为。

  var sourceTokenPattern =
    /(\/\/[^\n]*)|(\/\*[^]*?\*\/)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(import|from|export|default|const|let|var|async|await|function|return|if|else|for|of|in|new|class|extends|typeof|void|true|false|null|undefined)\b|\b(\d[\d_.]*)\b|([A-Za-z_$][\w$]*)(?=\s*\()/g;

  function highlightSourceCode(code) {
    if (code.hasAttribute("data-niceeval-highlighted")) return;
    var line = code.textContent || "";
    var fragment = document.createDocumentFragment();
    var last = 0;
    var match;
    sourceTokenPattern.lastIndex = 0;
    while ((match = sourceTokenPattern.exec(line))) {
      if (match.index > last) fragment.appendChild(document.createTextNode(line.slice(last, match.index)));
      var token = document.createElement("span");
      token.className = match[1] || match[2]
        ? "tok-comment"
        : match[3]
          ? "tok-str"
          : match[4]
            ? "tok-kw"
            : match[5]
              ? "tok-num"
              : "tok-fn";
      token.textContent = match[0];
      fragment.appendChild(token);
      last = match.index + match[0].length;
      if (match[0].length === 0) sourceTokenPattern.lastIndex++;
    }
    if (last < line.length) fragment.appendChild(document.createTextNode(line.slice(last)));
    code.replaceChildren(fragment);
    code.setAttribute("data-niceeval-highlighted", "");
  }

  function highlightSources(root) {
    if (!root || (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11)) return;
    if (root.nodeType === 1 && root.matches(".niceeval-source-code")) highlightSourceCode(root);
    var codes = root.querySelectorAll ? root.querySelectorAll(".niceeval-source-code") : [];
    for (var i = 0; i < codes.length; i++) highlightSourceCode(codes[i]);
  }

  highlightSources(document);
  new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      for (var j = 0; j < records[i].addedNodes.length; j++) highlightSources(records[i].addedNodes[j]);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  // ───────────────────────── Tabs:[data-niceeval-tabs] 单选切换 ─────────────────────────
  // 静态 HTML 每 tab 一个 <details> 且仅首个 open;点击 summary 时接管原生 toggle:
  // 打开所点 tab、收起同组其余,点已开的 tab 保持打开(单选语义,恒有一个面板可见)。
  // 只切换 open 状态,不触碰 tab 内任何数据;键盘 Enter/Space 走 summary 的原生激活(即 click)。

  document.addEventListener("click", function (e) {
    var title = closest(e.target, "[data-niceeval-tabs] > details > summary");
    if (!title) return;
    e.preventDefault();
    var tab = title.parentNode;
    var group = tab.parentNode;
    for (var i = 0; i < group.children.length; i++) {
      var child = group.children[i];
      if (child.tagName === "DETAILS") child.open = child === tab;
    }
  });

  // ───────────────────────── 复制:[data-niceeval-copy](宿主警告块的命令) ─────────────────────────
  // 点击把 data-niceeval-copy 携带的完整命令写进剪贴板,成功后短暂打上 data-niceeval-copied
  // (styles.css 显示 ✓);剪贴板不可用时退化为全选该块文本,用户手动复制。
  // 块内文本与属性值恒不变,复制的是数据侧已写好的命令原文。

  document.addEventListener("click", function (e) {
    var block = closest(e.target, "[data-niceeval-copy]");
    if (!block) return;
    var command = block.getAttribute("data-niceeval-copy") || "";
    function mark() {
      block.setAttribute("data-niceeval-copied", "");
      setTimeout(function () {
        block.removeAttribute("data-niceeval-copied");
      }, 1500);
    }
    function selectFallback() {
      var selection = window.getSelection();
      if (!selection) return;
      var range = document.createRange();
      range.selectNodeContents(block);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(command).then(mark, selectFallback);
    } else {
      selectFallback();
    }
  });

  // ───────────────────────── 排序:th[data-niceeval-sort] ─────────────────────────
  // 点击按该列排序 tbody 行(td/th 的 data-sort-value,数值优先、退回字符串;
  // 空值恒沉底),再点反向;方向指示由 th 上的 niceeval-sort-asc / niceeval-sort-desc 类驱动。

  function sortValue(row, index) {
    var cell = row.cells[index];
    if (!cell) return "";
    var v = cell.getAttribute("data-sort-value");
    return v !== null ? v : cell.textContent.trim();
  }

  document.addEventListener("click", function (e) {
    var th = closest(e.target, ".niceeval-report table th[data-niceeval-sort]");
    if (!th) return;
    var table = th.closest("table");
    var tbody = table && table.tBodies[0];
    if (!tbody) return;
    var index = Array.prototype.indexOf.call(th.parentNode.children, th);
    var dir = th.classList.contains("niceeval-sort-asc") ? "desc" : "asc";
    var siblings = th.parentNode.querySelectorAll("th[data-niceeval-sort]");
    for (var i = 0; i < siblings.length; i++) siblings[i].classList.remove("niceeval-sort-asc", "niceeval-sort-desc");
    th.classList.add(dir === "asc" ? "niceeval-sort-asc" : "niceeval-sort-desc");

    if (table.classList.contains("niceeval-table--hierarchical")) {
      var body = table.querySelector(".niceeval-table-hierarchy-body");
      var entries = body
        ? Array.prototype.slice.call(body.querySelectorAll(":scope > .niceeval-table-hierarchy-row"))
        : [];
      entries.sort(function (a, b) {
        var ac = a.querySelector(":scope > .niceeval-table-hierarchy-summary, :scope > .niceeval-table-hierarchy-cell");
        var bc = b.querySelector(":scope > .niceeval-table-hierarchy-summary, :scope > .niceeval-table-hierarchy-cell");
        var aCells = ac && ac.classList.contains("niceeval-table-hierarchy-summary") ? ac.children : a.children;
        var bCells = bc && bc.classList.contains("niceeval-table-hierarchy-summary") ? bc.children : b.children;
        var av = aCells[index] ? aCells[index].getAttribute("data-sort-value") || aCells[index].textContent.trim() : "";
        var bv = bCells[index] ? bCells[index].getAttribute("data-sort-value") || bCells[index].textContent.trim() : "";
        if (av === "" && bv === "") return 0;
        if (av === "") return 1;
        if (bv === "") return -1;
        var an = Number(av), bn = Number(bv);
        var compared = !isNaN(an) && !isNaN(bn) ? an - bn : String(av).localeCompare(String(bv));
        return dir === "asc" ? compared : -compared;
      });
      for (var h = 0; h < entries.length; h++) body.appendChild(entries[h]);
      return;
    }

    var rows = Array.prototype.slice.call(tbody.rows);
    rows.sort(function (a, b) {
      var va = sortValue(a, index);
      var vb = sortValue(b, index);
      // 空值 = 缺数据:恒沉底,与「缺数据不编 0」同一姿势
      if (va === "" && vb === "") return 0;
      if (va === "") return 1;
      if (vb === "") return -1;
      var na = Number(va);
      var nb = Number(vb);
      var out;
      if (!isNaN(na) && !isNaN(nb)) out = na - nb;
      else out = String(va).localeCompare(String(vb));
      return dir === "asc" ? out : -out;
    });
    for (var u = 0; u < rows.length; u++) tbody.appendChild(rows[u]);
  });

  // ───────────────────────── 过滤:input[data-niceeval-filter] ─────────────────────────
  // 对同容器内的表格行做 textContent 匹配,不匹配者加隐藏类(样式在 styles.css)。

  document.addEventListener("input", function (e) {
    var input = closest(e.target, "input[data-niceeval-filter]");
    if (!input) return;
    var sample = input.parentElement;
    var table = sample ? sample.querySelector("table") : null;
    if (!table || !table.tBodies[0]) return;
    var query = input.value.trim().toLowerCase();
    if (table.classList.contains("niceeval-table--hierarchical")) {
      // A top-level group's text includes every descendant. Filtering only its
      // direct children therefore leaves non-matching nested rows visible
      // whenever a sibling matches. Each rendered hierarchy row must receive
      // the same visibility decision independently.
      var entries = table.querySelectorAll(".niceeval-table-hierarchy-row");
      for (var h = 0; h < entries.length; h++) {
        entries[h].classList.toggle(
          "niceeval-row-hidden",
          query !== "" && entries[h].textContent.toLowerCase().indexOf(query) === -1,
        );
      }
      return;
    }
    var rows = table.tBodies[0].rows;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var hide = query !== "" && row.textContent.toLowerCase().indexOf(query) === -1;
      row.classList.toggle("niceeval-row-hidden", hide);
    }
  });

  // ───────────────────────── TurnTrace:trajectory toolbar + row accordion ─────────────────────────
  // 每个 ledger row、timeline span 和行内 evidence 都在 SSR 时生成。这里仅把
  // 它们按稳定 data id 联动：单开折叠，不 cloneNode、不搬动 evidence、也不依赖 CSS.escape。

  function traceByElement(element) {
    return element ? element.closest("[data-niceeval-turn-trace]") : null;
  }

  function traceElementsById(trace, attribute, id) {
    var nodes = trace.querySelectorAll("[" + attribute + "]");
    var found = [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute(attribute) === id) found.push(nodes[i]);
    }
    return found;
  }

  function traceElementById(trace, attribute, id) {
    var elements = traceElementsById(trace, attribute, id);
    return elements.length === 0 ? null : elements[0];
  }

  function activateTurnTraceEvidenceTab(evidence, tab) {
    if (!evidence) return;
    var buttons = evidence.querySelectorAll("[data-niceeval-trace-evidence-tab]");
    var panels = evidence.querySelectorAll("[data-niceeval-trace-evidence-panel]");
    for (var i = 0; i < buttons.length; i++) {
      var active = buttons[i].getAttribute("data-niceeval-trace-evidence-tab") === tab;
      buttons[i].setAttribute("aria-selected", active ? "true" : "false");
    }
    for (var j = 0; j < panels.length; j++) {
      var panelActive = panels[j].getAttribute("data-niceeval-trace-evidence-panel") === tab;
      panels[j].setAttribute("data-active", panelActive ? "true" : "false");
    }
  }

  function closeTurnTraceEvidence(trace) {
    if (!trace) return;
    var evidence = trace.querySelectorAll("[data-niceeval-trace-evidence]");
    for (var i = 0; i < evidence.length; i++) evidence[i].open = false;
    var selected = trace.querySelectorAll("[data-niceeval-trace-select][aria-pressed='true'], [data-niceeval-trace-timeline-event][aria-pressed='true']");
    for (var j = 0; j < selected.length; j++) {
      selected[j].setAttribute("aria-pressed", "false");
      if (selected[j].hasAttribute("data-niceeval-trace-select")) selected[j].setAttribute("aria-expanded", "false");
    }
  }

  function toggleTurnTraceEvidence(trace, eventId, reveal) {
    if (!trace || !eventId) return;
    var row = traceElementById(trace, "data-niceeval-trace-event", eventId);
    var evidence = traceElementById(trace, "data-niceeval-trace-evidence", eventId);
    if (!evidence || !row) return;
    var wasOpen = evidence.open;

    closeTurnTraceEvidence(trace);
    if (wasOpen) return;
    var turn = row.closest("[data-niceeval-trace-turn]");
    if (turn) setTurnCollapsed(turn, false);
    evidence.open = true;
    var rowSelectors = traceElementsById(trace, "data-niceeval-trace-select", eventId);
    var timelineSelectors = traceElementsById(trace, "data-niceeval-trace-timeline-event", eventId);
    for (var k = 0; k < rowSelectors.length; k++) {
      rowSelectors[k].setAttribute("aria-pressed", "true");
      rowSelectors[k].setAttribute("aria-expanded", "true");
    }
    for (var m = 0; m < timelineSelectors.length; m++) timelineSelectors[m].setAttribute("aria-pressed", "true");
    activateTurnTraceEvidenceTab(evidence, "preview");
    if (reveal && row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
  }

  function setTurnCollapsed(turn, collapsed) {
    if (!turn) return;
    turn.setAttribute("data-collapsed", collapsed ? "true" : "false");
    var toggle = turn.querySelector("[data-niceeval-trace-turn-toggle]");
    if (toggle) toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }

  function toggleAllTurns(trace) {
    var turns = trace.querySelectorAll("[data-niceeval-trace-turn]");
    if (turns.length === 0) return;
    var allCollapsed = true;
    for (var i = 0; i < turns.length; i++) {
      if (turns[i].getAttribute("data-collapsed") !== "true") {
        allCollapsed = false;
        break;
      }
    }
    for (var j = 0; j < turns.length; j++) setTurnCollapsed(turns[j], !allCollapsed);
    var control = trace.querySelector("[data-niceeval-trace-turns]");
    if (control) {
      control.setAttribute("aria-pressed", allCollapsed ? "false" : "true");
      var glyph = control.querySelector(".niceeval-trace-toolbar-glyph");
      if (glyph) glyph.textContent = allCollapsed ? "⊟" : "⊞";
    }
  }

  function toggleAllCalls(trace) {
    var collapsed = trace.getAttribute("data-calls-collapsed") === "true";
    trace.setAttribute("data-calls-collapsed", collapsed ? "false" : "true");
    var control = trace.querySelector("[data-niceeval-trace-calls]");
    if (control) {
      control.setAttribute("aria-pressed", collapsed ? "false" : "true");
      var glyph = control.querySelector(".niceeval-trace-toolbar-glyph");
      if (glyph) glyph.textContent = collapsed ? "⊟" : "⊞";
    }
  }

  function toggleTraceDuration(trace, control) {
    if (!trace || !control || control.disabled) return;
    var timeline = trace.querySelector("[data-niceeval-trace-timeline]");
    // Incomplete timing must remain equal-width sequence; never infer event clocks.
    if (!timeline || timeline.getAttribute("data-timing-complete") !== "true") return;
    var duration = trace.getAttribute("data-niceeval-duration-mode") === "duration";
    trace.setAttribute("data-niceeval-duration-mode", duration ? "sequence" : "duration");
    control.setAttribute("aria-pressed", duration ? "false" : "true");
  }

  function filterTurnTrace(input) {
    var trace = traceByElement(input);
    if (!trace) return;
    var query = (input.value || "").trim().toLowerCase();
    var events = trace.querySelectorAll("[data-niceeval-trace-event]");
    for (var i = 0; i < events.length; i++) {
      var event = events[i];
      var match = query === "" || (event.textContent || "").toLowerCase().indexOf(query) !== -1;
      event.classList.toggle("niceeval-row-hidden", !match);
      event.setAttribute("data-search-match", match ? "true" : "false");
      var id = event.getAttribute("data-niceeval-trace-event");
      if (!id) continue;
      var spans = traceElementsById(trace, "data-niceeval-trace-timeline-event", id);
      for (var j = 0; j < spans.length; j++) spans[j].setAttribute("data-search-match", match ? "true" : "false");
    }
    var turns = trace.querySelectorAll("[data-niceeval-trace-turn]");
    for (var k = 0; k < turns.length; k++) {
      var rows = turns[k].querySelectorAll("[data-niceeval-trace-event]");
      var hasMatch = false;
      for (var m = 0; m < rows.length; m++) {
        if (rows[m].getAttribute("data-search-match") === "true") {
          hasMatch = true;
          break;
        }
      }
      turns[k].setAttribute("data-search-empty", hasMatch ? "false" : "true");
      if (query !== "" && hasMatch) turns[k].setAttribute("data-search-active", "true");
      else turns[k].removeAttribute("data-search-active");
    }
  }

  document.addEventListener("click", function (e) {
    var tab = closest(e.target, "[data-niceeval-trace-evidence-tab]");
    if (tab) {
      activateTurnTraceEvidenceTab(tab.closest("[data-niceeval-trace-evidence]"), tab.getAttribute("data-niceeval-trace-evidence-tab"));
      return;
    }
    var duration = closest(e.target, "[data-niceeval-trace-duration]");
    if (duration) {
      toggleTraceDuration(traceByElement(duration), duration);
      return;
    }
    var turns = closest(e.target, "[data-niceeval-trace-turns]");
    if (turns) {
      toggleAllTurns(traceByElement(turns));
      return;
    }
    var calls = closest(e.target, "[data-niceeval-trace-calls]");
    if (calls) {
      toggleAllCalls(traceByElement(calls));
      return;
    }
    var turnToggle = closest(e.target, "[data-niceeval-trace-turn-toggle]");
    if (turnToggle) {
      var turn = turnToggle.closest("[data-niceeval-trace-turn]");
      setTurnCollapsed(turn, turn && turn.getAttribute("data-collapsed") !== "true");
      return;
    }
    var recordSelect = closest(e.target, "[data-niceeval-trace-select]");
    if (recordSelect) {
      toggleTurnTraceEvidence(traceByElement(recordSelect), recordSelect.getAttribute("data-niceeval-trace-select"), false);
      return;
    }
    var timelineSelect = closest(e.target, "[data-niceeval-trace-timeline-event]");
    if (timelineSelect) {
      toggleTurnTraceEvidence(traceByElement(timelineSelect), timelineSelect.getAttribute("data-niceeval-trace-timeline-event"), true);
    }
  });

  document.addEventListener("input", function (e) {
    var input = closest(e.target, "input[data-niceeval-trace-search]");
    if (input) filterTurnTrace(input);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var trace = traceByElement(e.target);
    if (trace) closeTurnTraceEvidence(trace);
  });

  // ───────────────────────── Matcher debugger → conversation ─────────────────────────
  // Analysis has already resolved the exact target. The browser only reveals,
  // scrolls to, and briefly highlights that row; it never joins by call name,
  // Turn position, DOM proximity, or provider identity.

  function conversationTargetIn(root, anchor) {
    if (!root || !anchor || !root.querySelectorAll) return null;
    var rows = root.querySelectorAll("[data-niceeval-conversation-anchor]");
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute("data-niceeval-conversation-anchor") === anchor) return rows[i];
    }
    return null;
  }

  function revealConversationTarget(target) {
    var ancestor = target.parentElement;
    while (ancestor) {
      if (ancestor.tagName === "DETAILS") ancestor.open = true;
      ancestor = ancestor.parentElement;
    }

    var turn = target.closest("[data-niceeval-trace-turn]");
    if (turn) setTurnCollapsed(turn, false);
    var eventId = target.getAttribute("data-niceeval-trace-event");
    var trace = traceByElement(target);
    var evidence = trace && eventId
      ? traceElementById(trace, "data-niceeval-trace-evidence", eventId)
      : null;
    if (trace && eventId && (!evidence || !evidence.open)) {
      toggleTurnTraceEvidence(trace, eventId, false);
    }

    target.classList.remove("niceeval-conversation-target-highlight");
    // Restart the CSS animation when the same target is selected repeatedly.
    void target.offsetWidth;
    target.classList.add("niceeval-conversation-target-highlight");
    if (target.scrollIntoView) target.scrollIntoView({ block: "center", behavior: "smooth" });
    window.setTimeout(function () {
      target.classList.remove("niceeval-conversation-target-highlight");
    }, 1800);
  }

  document.addEventListener("click", function (e) {
    var control = closest(e.target, "[data-niceeval-match-target]");
    if (!control) return;
    var anchor = control.getAttribute("data-niceeval-match-target");
    if (!anchor) return;
    var local = control.closest(".niceeval-source-line-detail") || control.closest(".niceeval-report");
    var target = conversationTargetIn(local, anchor) || conversationTargetIn(document, anchor);
    if (target) revealConversationTarget(target);
  });

  // ───────────────────────── tooltip:.niceeval-chart-dot ─────────────────────────
  // 首次 hover 时把点内 <title> 的内容搬进 data-niceeval-title(避免与原生 tooltip 重影),
  // 渲染样式化 tooltip div（定位在点上方并挂在所属 figure 中）；增强前保留 <title>。

  var tooltip = null;

  function hideTooltip() {
    if (tooltip && tooltip.parentNode) tooltip.parentNode.removeChild(tooltip);
    tooltip = null;
  }

  function tooltipText(point) {
    var text = point.getAttribute("data-niceeval-title");
    if (text === null) {
      var title = point.querySelector("title");
      text = title ? title.textContent : "";
      if (title && title.parentNode) title.parentNode.removeChild(title);
      point.setAttribute("data-niceeval-title", text);
    }
    return text;
  }

  document.addEventListener("mouseover", function (e) {
    var point = closest(e.target, ".niceeval-chart-dot");
    if (!point) return;
    var text = tooltipText(point);
    if (!text) return;
    var figure = point.closest("figure") || document.body;
    hideTooltip();
    tooltip = document.createElement("div");
    tooltip.className = "niceeval-tooltip";
    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = document.createElement(i === 0 ? "b" : "div");
      if (i > 0) line.className = "niceeval-tooltip-meta";
      line.textContent = lines[i];
      tooltip.appendChild(line);
    }
    if (getComputedStyle(figure).position === "static") figure.style.position = "relative";
    figure.appendChild(tooltip);
    var pointBox = point.getBoundingClientRect();
    var figureBox = figure.getBoundingClientRect();
    tooltip.style.left = pointBox.left + pointBox.width / 2 - figureBox.left + "px";
    tooltip.style.top = pointBox.top - figureBox.top + "px";
  });

  document.addEventListener("mouseout", function (e) {
    var point = closest(e.target, ".niceeval-chart-dot");
    if (!point) return;
    // 移入 tooltip 自身不算离开(pointer-events: none 下 relatedTarget 不会是它,防御性判断)
    if (e.relatedTarget && point.contains(e.relatedTarget)) return;
    hideTooltip();
  });
})();
