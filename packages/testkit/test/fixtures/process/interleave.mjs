const out = ["O1\n", "O2\n"];
const err = ["E1\n", "E2\n"];
const order = [
  () => process.stdout.write(out.shift()),
  () => process.stderr.write(err.shift()),
  () => process.stdout.write(out.shift()),
  () => process.stderr.write(err.shift()),
];
for (const step of order) {
  step();
}
process.exit(0);
