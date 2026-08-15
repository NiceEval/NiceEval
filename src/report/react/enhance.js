/*
 * Public, local-only enhancement for classic static reports. The HTML keeps
 * every tab, table row, and chart data table readable before this script runs.
 * No fetch of report data, storage, or generated metrics is involved.
 */
(() => {
  "use strict";
  if (typeof window === "undefined" || window.__nreEnhanced) return;
  window.__nreEnhanced = true;
  document.documentElement.classList.add("niceeval-js");

  function closest(target, selector) {
    return target && target.closest ? target.closest(selector) : null;
  }

  enhanceTabs();
  enhanceTables();
  enhanceTreeTables();
  enhanceFresh();
  enhanceCharts();
  enhanceCopy();

  function enhanceTabs() {
    const groups = document.querySelectorAll(".niceeval-classic-tabs");
    let groupIndex = 0;
    for (const group of groups) {
      const prefix = `niceeval-classic-tabs-${groupIndex}`;
      groupIndex += 1;
      if (group.getAttribute("data-niceeval-classic-tabs-enhanced") === "true") continue;

      const panels = Array.from(group.querySelectorAll(":scope > .niceeval-classic-tab"));
      const labels = panels.map((panel) => panel.querySelector("h1, h2, h3, h4, h5, h6"));
      if (panels.length < 2 || labels.some((label) => label === null || label.textContent.trim().length === 0)) continue;

      const tabList = document.createElement("div");
      tabList.className = "niceeval-classic-tablist";
      tabList.setAttribute("role", "tablist");

      const tabs = panels.map((panel, index) => {
        const panelId = `${prefix}-panel-${index}`;
        const tabId = `${prefix}-tab-${index}`;
        const tab = document.createElement("button");
        tab.type = "button";
        tab.id = tabId;
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-controls", panelId);
        tab.textContent = labels[index].textContent.trim();
        panel.id = panelId;
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", tabId);
        tabList.append(tab);
        return tab;
      });

      const select = (chosen, focus) => {
        for (let index = 0; index < tabs.length; index += 1) {
          const active = index === chosen;
          tabs[index].setAttribute("aria-selected", String(active));
          tabs[index].tabIndex = active ? 0 : -1;
          panels[index].hidden = !active;
        }
        if (focus) tabs[chosen].focus();
      };

      for (let index = 0; index < tabs.length; index += 1) {
        tabs[index].addEventListener("click", () => select(index, false));
        tabs[index].addEventListener("keydown", (event) => {
          let next;
          switch (event.key) {
            case "ArrowRight":
            case "ArrowDown":
              next = (index + 1) % tabs.length;
              break;
            case "ArrowLeft":
            case "ArrowUp":
              next = (index - 1 + tabs.length) % tabs.length;
              break;
            case "Home":
              next = 0;
              break;
            case "End":
              next = tabs.length - 1;
              break;
            default:
              return;
          }
          event.preventDefault();
          select(next, true);
        });
      }

      group.prepend(tabList);
      group.setAttribute("data-niceeval-classic-tabs-enhanced", "true");
      select(0, false);
    }
  }

  function enhanceTables() {
    const tables = document.querySelectorAll(".niceeval-classic .niceeval-report__table, .niceeval-classic-table .niceeval-report__table");
    for (const table of tables) {
      if (table.getAttribute("data-niceeval-classic-table-enhanced") === "true") continue;
      table.setAttribute("data-niceeval-classic-table-enhanced", "true");
      const headers = table.querySelectorAll("thead th");
      for (const header of headers) header.setAttribute("data-niceeval-sort", "");
      const wrap = table.closest(".niceeval-report__table-wrap") || table.parentElement;
      const shell = table.closest(".niceeval-classic-searchable, .niceeval-classic-experiment-table");
      if (wrap && shell && !wrap.querySelector(":scope > .niceeval-classic-filter")) {
        const input = document.createElement("input");
        input.type = "search";
        input.className = "niceeval-classic-filter";
        input.setAttribute("data-niceeval-filter", "");
        input.placeholder = "Filter experiments...";
        wrap.prepend(input);
      }
    }

    document.addEventListener("click", (event) => {
      const th = closest(event.target, ".niceeval-classic table th[data-niceeval-sort]");
      if (!th) return;
      const table = th.closest("table");
      const tbody = table && table.tBodies[0];
      if (!tbody) return;
      const index = Array.prototype.indexOf.call(th.parentNode.children, th);
      const dir = th.classList.contains("niceeval-sort-asc") ? "desc" : "asc";
      const siblings = th.parentNode.querySelectorAll("th[data-niceeval-sort]");
      for (const sibling of siblings) sibling.classList.remove("niceeval-sort-asc", "niceeval-sort-desc");
      th.classList.add(dir === "asc" ? "niceeval-sort-asc" : "niceeval-sort-desc");
      const rows = Array.prototype.slice.call(tbody.rows);
      rows.sort((left, right) => compareSort(sortValue(left, index), sortValue(right, index), dir));
      for (const row of rows) tbody.append(row);
    });

    document.addEventListener("input", (event) => {
      const input = closest(event.target, "input[data-niceeval-filter]");
      if (!input) return;
      const query = input.value.trim().toLowerCase();
      const table = input.parentElement && input.parentElement.querySelector("table");
      if (table && table.tBodies[0]) {
        const rows = table.tBodies[0].rows;
        for (const row of rows) {
          row.classList.toggle("niceeval-row-hidden", query !== "" && row.textContent.toLowerCase().indexOf(query) === -1);
        }
      }
      const tree = input.closest(".niceeval-classic-table-tree") ||
        (input.parentElement && input.parentElement.querySelector(".niceeval-classic-table-tree"));
      if (tree) {
        const groups = tree.querySelectorAll(":scope > .niceeval-classic-table-body > .niceeval-classic-table-group, :scope > .niceeval-classic-table-body > .niceeval-classic-table-row");
        for (const group of groups) {
          group.classList.toggle("niceeval-row-hidden", query !== "" && group.textContent.toLowerCase().indexOf(query) === -1);
        }
      }
    });
  }

  function enhanceTreeTables() {
    const trees = document.querySelectorAll(".niceeval-classic-table-tree");
    for (const tree of trees) {
      if (tree.getAttribute("data-niceeval-classic-table-enhanced") === "true") continue;
      tree.setAttribute("data-niceeval-classic-table-enhanced", "true");
      const shell = tree.closest(".niceeval-classic-searchable, .niceeval-classic-experiment-table") || tree;
      if (!shell.querySelector(":scope > .niceeval-classic-filter") && !tree.querySelector(":scope > .niceeval-classic-filter")) {
        const input = document.createElement("input");
        input.type = "search";
        input.className = "niceeval-classic-filter";
        input.setAttribute("data-niceeval-filter", "");
        input.setAttribute("aria-label", "Filter experiments");
        input.placeholder = "Filter experiments...";
        tree.prepend(input);
      }
      upgradeTreeSortHeaders(tree);
    }

    document.addEventListener("click", (event) => {
      const header = closest(event.target, ".niceeval-classic-table-head [data-niceeval-sort]");
      if (!header) return;
      const tree = header.closest(".niceeval-classic-table-tree");
      if (!tree) return;
      sortTreeGroups(tree, header);
    });
  }

  function upgradeTreeSortHeaders(tree) {
    const head = tree.querySelector(":scope > .niceeval-classic-table-head");
    if (!head) return;
    const headers = Array.prototype.slice.call(head.children);
    for (const header of headers) {
      if (header.tagName === "BUTTON" || header.getAttribute("data-niceeval-sort") !== null) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = header.className;
      button.setAttribute("data-niceeval-sort", "");
      button.setAttribute("aria-sort", headerSortState(header));
      while (header.firstChild) button.appendChild(header.firstChild);
      header.replaceWith(button);
    }
  }

  function headerSortState(header) {
    if (header.classList.contains("niceeval-sort-asc")) return "ascending";
    if (header.classList.contains("niceeval-sort-desc")) return "descending";
    return "none";
  }

  function sortTreeGroups(tree, header) {
    const head = header.parentNode;
    if (!head) return;
    const index = Array.prototype.indexOf.call(head.children, header);
    if (index < 0) return;
    const dir = header.classList.contains("niceeval-sort-asc") ? "desc" : "asc";
    const siblings = head.querySelectorAll("[data-niceeval-sort]");
    for (const sibling of siblings) {
      sibling.classList.remove("niceeval-sort-asc", "niceeval-sort-desc");
      sibling.setAttribute("aria-sort", "none");
    }
    header.classList.add(dir === "asc" ? "niceeval-sort-asc" : "niceeval-sort-desc");
    header.setAttribute("aria-sort", dir === "asc" ? "ascending" : "descending");

    const body = tree.querySelector(":scope > .niceeval-classic-table-body");
    if (!body) return;
    const groups = Array.prototype.filter.call(body.children, isTopLevelTreeGroup);
    const decorated = groups.map((group, order) => ({
      group,
      order,
      value: treeGroupSortText(group, index),
    }));
    decorated.sort((left, right) => {
      const compared = compareTreeSort(left.value, right.value, dir);
      return compared !== 0 ? compared : left.order - right.order;
    });
    for (const entry of decorated) body.appendChild(entry.group);
  }

  function isTopLevelTreeGroup(node) {
    return Boolean(node.classList) && (
      node.classList.contains("niceeval-classic-table-group") ||
      node.classList.contains("niceeval-classic-table-row")
    );
  }

  function treeGroupSortText(group, index) {
    const row = group.tagName === "DETAILS"
      ? group.querySelector(":scope > summary.niceeval-classic-table-row") || group
      : group;
    const cell = row.children[index];
    return cell ? String(cell.textContent || "").trim() : "";
  }

  function compareTreeSort(left, right, dir) {
    if (isEmptySortText(left) && isEmptySortText(right)) return 0;
    if (isEmptySortText(left)) return 1;
    if (isEmptySortText(right)) return -1;
    const leftNumber = parseDisplaySortNumber(left);
    const rightNumber = parseDisplaySortNumber(right);
    const compared = leftNumber !== undefined && rightNumber !== undefined
      ? leftNumber - rightNumber
      : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
    return dir === "asc" ? compared : -compared;
  }

  function isEmptySortText(value) {
    return value === "" || value === "—" || value === "unavailable" || value === "不可用";
  }

  function parseDisplaySortNumber(value) {
    const duration = parseDisplayDuration(value);
    if (duration !== undefined) return duration;
    const compact = String(value).replace(/,/g, "").trim();
    const percent = compact.match(/^(-?\d+(?:\.\d+)?)\s*%/);
    if (percent) return Number(percent[1]);
    const currency = compact.match(/(?:US\$|\$)\s*(-?\d+(?:\.\d+)?)/i);
    if (currency) return Number(currency[1]);
    if (/^-?\d+(?:\.\d+)?$/.test(compact)) return Number(compact);
    return undefined;
  }

  function parseDisplayDuration(value) {
    const text = String(value);
    if (!/\d+\s*[hms]\b/i.test(text)) return undefined;
    let ms = 0;
    let matched = false;
    const hour = text.match(/(\d+)\s*h\b/i);
    const minute = text.match(/(\d+)\s*m\b/i);
    const second = text.match(/(\d+)\s*s\b/i);
    if (hour) {
      ms += Number(hour[1]) * 3600000;
      matched = true;
    }
    if (minute) {
      ms += Number(minute[1]) * 60000;
      matched = true;
    }
    if (second) {
      ms += Number(second[1]) * 1000;
      matched = true;
    }
    return matched ? ms : undefined;
  }

  function enhanceCharts() {
    const tables = document.querySelectorAll(".niceeval-classic .niceeval-report__chart-data[open]");
    for (const details of tables) details.open = false;

    let tooltip = null;
    const hide = () => {
      if (tooltip && tooltip.parentNode) tooltip.parentNode.removeChild(tooltip);
      tooltip = null;
    };
    const textOf = (point) => {
      let text = point.getAttribute("data-niceeval-title");
      if (text === null) {
        const title = point.querySelector("title");
        text = title ? title.textContent : "";
        if (title && title.parentNode) title.parentNode.removeChild(title);
        point.setAttribute("data-niceeval-title", text);
      }
      return text;
    };

    document.addEventListener("mouseover", (event) => {
      const point = closest(event.target, ".niceeval-report__chart-point, .niceeval-report__chart-bar, .niceeval-chart-dot");
      if (!point) return;
      const text = textOf(point);
      if (!text) return;
      const figure = point.closest("figure") || document.body;
      hide();
      tooltip = document.createElement("div");
      tooltip.className = "niceeval-tooltip";
      const lines = text.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        const line = document.createElement(index === 0 ? "b" : "div");
        if (index > 0) line.className = "niceeval-tooltip-meta";
        line.textContent = lines[index];
        tooltip.append(line);
      }
      if (getComputedStyle(figure).position === "static") figure.style.position = "relative";
      figure.append(tooltip);
      const pointBox = point.getBoundingClientRect();
      const figureBox = figure.getBoundingClientRect();
      tooltip.style.left = `${pointBox.left + pointBox.width / 2 - figureBox.left}px`;
      tooltip.style.top = `${pointBox.top - figureBox.top}px`;
    });

    document.addEventListener("mouseout", (event) => {
      const point = closest(event.target, ".niceeval-report__chart-point, .niceeval-report__chart-bar, .niceeval-chart-dot");
      if (!point) return;
      if (event.relatedTarget && point.contains(event.relatedTarget)) return;
      hide();
    });
  }

  function enhanceFresh() {
    const tables = document.querySelectorAll(".niceeval-classic-experiment-table");
    for (const table of tables) {
      if (table.getAttribute("data-niceeval-classic-fresh-enhanced") === "true") continue;
      if (!table.querySelector(".niceeval-classic-stale")) continue;
      table.setAttribute("data-niceeval-classic-fresh-enhanced", "true");
      const label = document.createElement("label");
      label.className = "niceeval-classic-fresh-toggle";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("data-niceeval-fresh-toggle", "");
      label.append(input, document.createTextNode(" Fresh executions only"));
      table.prepend(label);
      input.addEventListener("change", () => {
        table.classList.toggle("niceeval-classic-fresh-only", input.checked);
      });
    }
  }

  function enhanceCopy() {
    document.addEventListener("click", (event) => {
      const block = closest(event.target, "[data-niceeval-copy]");
      if (!block) return;
      const command = block.getAttribute("data-niceeval-copy") || block.textContent;
      const mark = () => {
        block.setAttribute("data-niceeval-copied", "");
        setTimeout(() => block.removeAttribute("data-niceeval-copied"), 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(command).then(mark).catch(() => {});
      }
    });
  }

  function sortValue(row, index) {
    const cell = row.cells[index];
    if (!cell) return "";
    const value = cell.getAttribute("data-sort-value");
    return value !== null ? value : cell.textContent.trim();
  }

  function compareSort(left, right, dir) {
    if (left === "" && right === "") return 0;
    if (left === "") return 1;
    if (right === "") return -1;
    const leftNumber = Number(String(left).replace(/[^0-9.+-]/g, ""));
    const rightNumber = Number(String(right).replace(/[^0-9.+-]/g, ""));
    const compared = !Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)
      ? leftNumber - rightNumber
      : String(left).localeCompare(String(right));
    return dir === "asc" ? compared : -compared;
  }
})();
