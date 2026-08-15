/*
 * Public, local-only enhancement for classic static reports. The HTML keeps
 * every tab as a readable section before this script runs. No fetch, storage,
 * URL mutation, or generated report data is involved.
 */
(() => {
  "use strict";

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
})();
