const stdoutFlood = `${"a".repeat(5000)}FLOOD-STDOUT-END\n`;
const stderrFlood = `${"b".repeat(5000)}FLOOD-STDERR-END\n`;
process.stdout.write(stdoutFlood);
process.stderr.write(stderrFlood);
process.exit(0);
