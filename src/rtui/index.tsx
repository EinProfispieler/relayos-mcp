import { render } from "ink";
import { App } from "./App.js";
import { readAllStdin, runStdoutTransport } from "./runtime/stdoutTransport.js";

async function main(): Promise<void> {
  if (!process.stdout.isTTY) {
    const input = await readAllStdin();
    await runStdoutTransport({ writer: (c) => process.stdout.write(c), input });
    return;
  }

  const instance = render(<App />, {
    exitOnCtrlC: false,
    patchConsole: true,
  });
  await instance.waitUntilExit();
}

main().catch((err) => {
  process.stderr.write(`rtui crashed: ${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
