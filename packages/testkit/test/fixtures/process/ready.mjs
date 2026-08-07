process.on("SIGTERM", () => {
  process.exit(0);
});
process.stdout.write("READY\n");
setInterval(() => {}, 1000);
