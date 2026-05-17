import { test, expect } from "bun:test";
import { SLASH_COMMANDS, filterCommands, isSelectable } from "./registry.js";

test("registry has expected command names in declared order", () => {
  expect(SLASH_COMMANDS.map((c) => c.name)).toEqual([
    "/help",
    "/status",
    "/recent",
    "/next",
    "/results",
    "/settings",
    "/exit",
    "/approve",
    "/run",
  ]);
});

test("each cli command has argv; disabled commands do not", () => {
  for (const c of SLASH_COMMANDS) {
    if (c.kind === "cli") expect(c.argv && c.argv.length > 0).toBe(true);
    if (c.kind === "disabled") expect(c.argv).toBeUndefined();
  }
});

test("no duplicate command names", () => {
  const names = SLASH_COMMANDS.map((c) => c.name);
  expect(new Set(names).size).toBe(names.length);
});

test("filterCommands matches by prefix on the substring after /", () => {
  expect(filterCommands("/").map((c) => c.name)).toEqual(SLASH_COMMANDS.map((c) => c.name));
  expect(filterCommands("/he").map((c) => c.name)).toEqual(["/help"]);
  expect(filterCommands("/r").map((c) => c.name)).toEqual(["/recent", "/results", "/run"]);
  expect(filterCommands("/zzz")).toEqual([]);
});

test("filterCommands is case-insensitive", () => {
  expect(filterCommands("/HE").map((c) => c.name)).toEqual(["/help"]);
});

test("isSelectable returns false for disabled commands", () => {
  const approve = SLASH_COMMANDS.find((c) => c.name === "/approve");
  expect(approve).toBeDefined();
  expect(isSelectable(approve!)).toBe(false);
  const help = SLASH_COMMANDS.find((c) => c.name === "/help");
  expect(isSelectable(help!)).toBe(true);
});
