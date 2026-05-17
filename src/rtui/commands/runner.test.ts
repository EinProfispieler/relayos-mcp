import { test, expect, mock } from "bun:test";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { runCliCommand, type CliSpawner } from "./runner.js";
import type { RTUIAction } from "../state/types.js";

function makeFakeChild(stdoutChunks: string[], exitCode = 0) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: Readable;
  };
  child.stdout = Readable.from(stdoutChunks);
  child.stderr = Readable.from([]);
  queueMicrotask(() => {
    setTimeout(() => child.emit("exit", exitCode), 5);
  });
  return child;
}

test("runCliCommand dispatches START, OUTPUT lines, then COMPLETE", async () => {
  const dispatched: RTUIAction[] = [];
  const dispatch = (a: RTUIAction) => { dispatched.push(a); };
  const spawn: CliSpawner = mock(() => makeFakeChild(["alpha\nbeta\n"], 0)) as unknown as CliSpawner;

  await runCliCommand({
    commandName: "/status",
    argv: ["overseer", "status"],
    dispatch,
    spawn,
  });

  expect(dispatched[0]).toMatchObject({ type: "CLI_COMMAND_START", commandName: "/status" });
  const outputs = dispatched.filter((a) => a.type === "CLI_OUTPUT_LINE");
  expect(outputs.map((o) => (o as { line: string }).line)).toEqual(["alpha", "beta"]);
  expect(dispatched[dispatched.length - 1]).toMatchObject({
    type: "CLI_COMMAND_COMPLETE",
    exitCode: 0,
  });
});

test("runCliCommand prefixes stderr lines", async () => {
  const dispatched: RTUIAction[] = [];
  const dispatch = (a: RTUIAction) => { dispatched.push(a); };
  const child = new EventEmitter() as EventEmitter & { stdout: Readable; stderr: Readable };
  child.stdout = Readable.from([]);
  child.stderr = Readable.from(["boom\n"]);
  queueMicrotask(() => setTimeout(() => child.emit("exit", 1), 5));
  const spawn: CliSpawner = mock(() => child) as unknown as CliSpawner;

  await runCliCommand({
    commandName: "/status",
    argv: ["overseer", "status"],
    dispatch,
    spawn,
  });

  const outputs = dispatched.filter((a) => a.type === "CLI_OUTPUT_LINE");
  expect(outputs.map((o) => (o as { line: string }).line)).toEqual(["[stderr] boom"]);
  expect(dispatched[dispatched.length - 1]).toMatchObject({
    type: "CLI_COMMAND_COMPLETE",
    exitCode: 1,
  });
});

test("runCliCommand dispatches an error line and exitCode -1 when spawn throws", async () => {
  const dispatched: RTUIAction[] = [];
  const dispatch = (a: RTUIAction) => { dispatched.push(a); };
  const spawn: CliSpawner = (() => {
    throw new Error("ENOENT");
  }) as unknown as CliSpawner;

  await runCliCommand({
    commandName: "/status",
    argv: ["overseer", "status"],
    dispatch,
    spawn,
  });

  const outputs = dispatched.filter((a) => a.type === "CLI_OUTPUT_LINE");
  expect(outputs.map((o) => (o as { line: string }).line).join(" ")).toContain("ENOENT");
  expect(dispatched[dispatched.length - 1]).toMatchObject({
    type: "CLI_COMMAND_COMPLETE",
    exitCode: -1,
  });
});
