process.on("SIGTERM", () => {
  // 故意吞掉 TERM：只有组 KILL 能结束它，用于证明 dispose 的组终结范围
});
setInterval(() => {}, 1000);
