import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { RTUIAction } from "../state/types.js";

export type CliSpawner = (
  command: string,
  args: readonly string[],
  options: { stdio: ["ignore", "pipe", "pipe"] },
) => ChildProcess;

export interface RunCliCommandOptions {
  commandName: string;
  argv: readonly string[];
  dispatch: (action: RTUIAction) => void;
  spawn?: CliSpawner;
  cliJsPath?: string;
  nodeBin?: string;
}

const DEFAULT_CLI_JS_PATH = fileURLToPath(new URL("../../../dist/cli.js", import.meta.url));

export async function runCliCommand(opts: RunCliCommandOptions): Promise<void> {
  const {
    commandName,
    argv,
    dispatch,
    spawn = nodeSpawn as unknown as CliSpawner,
    cliJsPath = DEFAULT_CLI_JS_PATH,
    nodeBin = process.execPath,
  } = opts;

  dispatch({ type: "CLI_COMMAND_START", commandName, argv });

  let child: ChildProcess;
  try {
    child = spawn(nodeBin, [cliJsPath, ...argv], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    dispatch({ type: "CLI_OUTPUT_LINE", line: `error: ${msg}` });
    dispatch({ type: "CLI_COMMAND_COMPLETE", exitCode: -1 });
    return;
  }

  const drain = (stream: NodeJS.ReadableStream | null, prefix: string) => {
    return new Promise<void>((resolve) => {
      if (!stream) { resolve(); return; }
      let buf = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        buf += chunk;
        let idx: number;
        while ((idx = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          dispatch({ type: "CLI_OUTPUT_LINE", line: prefix + line });
        }
      });
      stream.on("end", () => {
        if (buf.length > 0) dispatch({ type: "CLI_OUTPUT_LINE", line: prefix + buf });
        resolve();
      });
      stream.on("error", () => resolve());
    });
  };

  const exited = new Promise<number>((resolve) => {
    child.on("exit", (code) => resolve(code ?? 0));
    child.on("error", () => resolve(-1));
  });

  const [, , exitCode] = await Promise.all([
    drain(child.stdout, ""),
    drain(child.stderr, "[stderr] "),
    exited,
  ]);

  dispatch({ type: "CLI_COMMAND_COMPLETE", exitCode });
}
