process.stdout.write("LISTENING\n");
process.on("SIGINT", () => {
  process.stdout.write("GOT-SIGINT\n");
  process.exit(42);
});
process.on("SIGTERM", () => {
  process.exit(0);
});
setInterval(() => {}, 1000);
