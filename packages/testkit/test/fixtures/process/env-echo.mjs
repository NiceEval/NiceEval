process.stdout.write(`ENV-ECHO:${process.env.NICE_TEST_VAR ?? "UNSET"}\n`);
process.stdout.write(`HAS-PATH:${process.env.PATH ? "yes" : "no"}\n`);
process.exit(0);
