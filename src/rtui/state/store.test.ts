import { describe, expect, test } from "bun:test";
import { initialState, reducer } from "./store.js";
import type { RTUIState, ScrollbackItem } from "./types.js";

const baseState = (): RTUIState =>
  initialState({
    projectDir: "test",
    branch: "main",
    model: "test-model",
    effort: "medium",
    isGitRepo: true,
  });

describe("INPUT_CHANGED", () => {
  test("updates value and cursor", () => {
    const next = reducer(baseState(), {
      type: "INPUT_CHANGED",
      value: "hi",
      cursor: 2,
    });
    expect(next.input.value).toBe("hi");
    expect(next.input.cursor).toBe(2);
  });
});

describe("INPUT_SUBMITTED", () => {
  test("clears input value and cursor", () => {
    const start = { ...baseState() };
    start.input = { ...start.input, value: "hello", cursor: 5 };
    const next = reducer(start, { type: "INPUT_SUBMITTED" });
    expect(next.input.value).toBe("");
    expect(next.input.cursor).toBe(0);
  });

  test("prepends submitted value to history (deduplicated)", () => {
    const start = { ...baseState() };
    start.input = { ...start.input, value: "hello", cursor: 5, history: ["older"] };
    const next = reducer(start, { type: "INPUT_SUBMITTED" });
    expect(next.input.history).toEqual(["hello", "older"]);
  });

  test("does not duplicate consecutive history entries", () => {
    const start = { ...baseState() };
    start.input = { ...start.input, value: "hello", cursor: 5, history: ["hello"] };
    const next = reducer(start, { type: "INPUT_SUBMITTED" });
    expect(next.input.history).toEqual(["hello"]);
  });

  test("empty value submission is a no-op", () => {
    const start = baseState();
    const next = reducer(start, { type: "INPUT_SUBMITTED" });
    expect(next).toBe(start);
  });
});

describe("SCROLLBACK_APPEND", () => {
  test("appends new item without mutating old array", () => {
    const start = baseState();
    const item: ScrollbackItem = { id: "1", type: "user_input", text: "hi" };
    const next = reducer(start, { type: "SCROLLBACK_APPEND", item });
    expect(next.scrollback).toHaveLength(1);
    expect(next.scrollback[0]).toBe(item);
    expect(next.scrollback).not.toBe(start.scrollback);
  });

  test("preserves old item identities on append (Static rule)", () => {
    const item1: ScrollbackItem = { id: "1", type: "user_input", text: "first" };
    const item2: ScrollbackItem = { id: "2", type: "user_input", text: "second" };
    const after1 = reducer(baseState(), { type: "SCROLLBACK_APPEND", item: item1 });
    const after2 = reducer(after1, { type: "SCROLLBACK_APPEND", item: item2 });
    expect(after2.scrollback[0]).toBe(after1.scrollback[0]); // same reference!
    expect(after2.scrollback[1]).toBe(item2);
  });
});

describe("LIVE_*", () => {
  test("LIVE_SET_SPINNER sets spinner", () => {
    const next = reducer(baseState(), { type: "LIVE_SET_SPINNER", spinner: "⠋" });
    expect(next.live.spinner).toBe("⠋");
  });

  test("LIVE_SET_STREAM sets streaming text", () => {
    const next = reducer(baseState(), { type: "LIVE_SET_STREAM", text: "partial" });
    expect(next.live.streaming).toBe("partial");
  });

  test("LIVE_CLEAR clears all live state", () => {
    let state = reducer(baseState(), { type: "LIVE_SET_SPINNER", spinner: "⠋" });
    state = reducer(state, { type: "LIVE_SET_STREAM", text: "partial" });
    const next = reducer(state, { type: "LIVE_CLEAR" });
    expect(next.live.spinner).toBeNull();
    expect(next.live.streaming).toBeNull();
    expect(next.live.progress).toBeNull();
  });
});

describe("STATUS_SET", () => {
  test("updates status", () => {
    const next = reducer(baseState(), { type: "STATUS_SET", status: "thinking" });
    expect(next.status).toBe("thinking");
  });
});

describe("RUNTIME_UPDATED", () => {
  test("replaces runtime view", () => {
    const next = reducer(baseState(), {
      type: "RUNTIME_UPDATED",
      runtime: {
        projectDir: "other",
        branch: "feature",
        model: "new-model",
        effort: "high",
        isGitRepo: false,
      },
    });
    expect(next.runtime.branch).toBe("feature");
    expect(next.runtime.model).toBe("new-model");
  });
});

describe("HISTORY_PREV/NEXT", () => {
  test("HISTORY_PREV loads most recent entry into input", () => {
    const start = baseState();
    start.input = { ...start.input, history: ["second", "first"] };
    const next = reducer(start, { type: "HISTORY_PREV" });
    expect(next.input.value).toBe("second");
    expect(next.input.historyIndex).toBe(0);
  });

  test("HISTORY_PREV stops at oldest entry", () => {
    const start = baseState();
    start.input = { ...start.input, history: ["second", "first"], historyIndex: 1 };
    const next = reducer(start, { type: "HISTORY_PREV" });
    expect(next.input.value).toBe("first");
    expect(next.input.historyIndex).toBe(1);
  });

  test("HISTORY_NEXT clears index past newest", () => {
    const start = baseState();
    start.input = { ...start.input, history: ["second"], historyIndex: 0, value: "second" };
    const next = reducer(start, { type: "HISTORY_NEXT" });
    expect(next.input.historyIndex).toBeNull();
    expect(next.input.value).toBe("");
  });
});
