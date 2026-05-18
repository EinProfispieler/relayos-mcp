import { test, expect, describe } from "bun:test";
import { SLASH_COMMANDS, filterCommands, isSelectable } from "./registry.js";

describe("SLASH_COMMANDS registry", () => {
  test("has expected command names in declared order", () => {
    expect(SLASH_COMMANDS.map((c) => c.name)).toEqual([
      "/help",
      "/status",
      "/recent",
      "/next",
      "/results",
      "/settings",
      "/setup",
      "/exit",
      "/approve",
      "/run",
      "/build",
    ]);
  });

  test("no duplicate command names", () => {
    const names = SLASH_COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("each cli command has argv", () => {
    for (const c of SLASH_COMMANDS) {
      if (c.kind === "cli") expect(c.argv && c.argv.length > 0).toBe(true);
    }
  });

  test("no command is disabled", () => {
    for (const c of SLASH_COMMANDS) {
      expect(c.kind).not.toBe("disabled");
    }
  });

  test("/approve is local with localHandler 'approve'", () => {
    const approve = SLASH_COMMANDS.find((c) => c.name === "/approve");
    expect(approve?.kind).toBe("local");
    expect(approve?.localHandler).toBe("approve");
  });

  test("/run is local with localHandler 'run'", () => {
    const run = SLASH_COMMANDS.find((c) => c.name === "/run");
    expect(run?.kind).toBe("local");
    expect(run?.localHandler).toBe("run");
  });

  test("/build is local with localHandler 'build'", () => {
    const build = SLASH_COMMANDS.find((c) => c.name === "/build");
    expect(build?.kind).toBe("local");
    expect(build?.localHandler).toBe("build");
  });

  test("all local commands are selectable", () => {
    const locals = SLASH_COMMANDS.filter((c) => c.kind === "local");
    for (const c of locals) {
      expect(isSelectable(c)).toBe(true);
    }
  });
});

describe("filterCommands", () => {
  test("/ matches all", () => {
    expect(filterCommands("/").map((c) => c.name)).toEqual(SLASH_COMMANDS.map((c) => c.name));
  });

  test("prefix /he matches /help only", () => {
    expect(filterCommands("/he").map((c) => c.name)).toEqual(["/help"]);
  });

  test("prefix /r matches /recent, /results, /run", () => {
    expect(filterCommands("/r").map((c) => c.name)).toEqual(["/recent", "/results", "/run"]);
  });

  test("prefix /b matches /build", () => {
    expect(filterCommands("/b").map((c) => c.name)).toEqual(["/build"]);
  });

  test("case-insensitive", () => {
    expect(filterCommands("/HE").map((c) => c.name)).toEqual(["/help"]);
    expect(filterCommands("/BUILD").map((c) => c.name)).toEqual(["/build"]);
  });

  test("unmatched prefix returns empty", () => {
    expect(filterCommands("/zzz")).toEqual([]);
  });
});
