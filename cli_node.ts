import { runCli } from "./src/interface/cli/run.ts";

const exitCode = await runCli(process.argv.slice(2));
if (exitCode !== 0) {
  process.exit(exitCode);
}
