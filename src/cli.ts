import { pathToFileURL } from "node:url";
import {
  buildLaunchCommand,
  LaunchResolutionError,
  resolveHandoff,
} from "./launch.js";

interface CliIO {
  stdout: { write: (chunk: string) => unknown };
  stderr: { write: (chunk: string) => unknown };
}

function usage(): string {
  return "usage: relayos launch [latest|N|handoff_id]\n";
}

function isLaunchResolutionError(err: unknown): err is LaunchResolutionError {
  return err instanceof LaunchResolutionError;
}

export async function runCli(
  argv = process.argv.slice(2),
  io: CliIO = { stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
  const [command, arg, ...rest] = argv;

  if (command === "--help" || command === "-h") {
    io.stdout.write(usage());
    return 0;
  }

  if (command !== "launch" || rest.length > 0) {
    io.stderr.write(usage());
    return 1;
  }

  try {
    const envelope = await resolveHandoff(arg);
    io.stdout.write(`${buildLaunchCommand(envelope)}\n`);
    return 0;
  } catch (err) {
    const message = isLaunchResolutionError(err)
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
    io.stderr.write(`relayos launch: ${message}\n`);
    return 1;
  }
}

const entrypoint = process.argv[1];
const isDirectInvocation =
  entrypoint !== undefined &&
  (import.meta.url === pathToFileURL(entrypoint).href ||
    entrypoint.endsWith("/dist/cli.js") ||
    entrypoint.endsWith("relayos"));

if (isDirectInvocation) {
  runCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`[relayos] fatal: ${err?.stack ?? err}\n`);
      process.exitCode = 1;
    });
}
