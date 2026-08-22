// 本文件由 scripts/gen-diff-code.ts 生成（pnpm run gen:diff-code），不要手工编辑
// GitHub 式 diff 展开条：点击后显示折叠的未变更行（配合 github-diff.css 的 .gd-fold）
document.addEventListener("click", (e) => {
  const tr = e.target && e.target.closest ? e.target.closest("tr.gd-expand") : null;
  if (!tr) return;
  const id = tr.getAttribute("data-fold");
  const tbody = tr.closest("tbody");
  if (!id || !tbody) return;
  tbody.querySelectorAll("tr." + id).forEach((row) => row.classList.remove("gd-fold"));
  tr.remove();
});
