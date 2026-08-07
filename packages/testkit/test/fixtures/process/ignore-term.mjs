process.stdout.write("STARTED\n");
process.on("SIGTERM", () => {
  // 故意吞掉 TERM：dispose 必须在 grace 后用 KILL 结束它
});
setInterval(() => {}, 1000);
