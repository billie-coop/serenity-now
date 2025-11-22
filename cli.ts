#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env

import { runCli } from "./src/interface/cli/run.ts";

if (import.meta.main) {
  const exitCode = await runCli(Deno.args);
  if (exitCode !== 0) {
    Deno.exit(exitCode);
  }
}
