import { test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { ScrollbackArea } from "./ScrollbackArea.js";
import type { PlanReportData } from "../../project_plan.js";
import type { ProjectPlanView, ScrollbackItem } from "../state/types.js";

test("renders user_input with ❯ prefix", () => {
  const items: ScrollbackItem[] = [{ id: "1", type: "user_input", text: "hello" }];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  expect(lastFrame()).toContain("❯ hello");
});

test("renders assistant_text without prefix", () => {
  const items: ScrollbackItem[] = [{ id: "1", type: "assistant_text", text: "world" }];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  expect(lastFrame()).toContain("world");
});

test("renders system_note with ✓ prefix", () => {
  const items: ScrollbackItem[] = [{ id: "1", type: "system_note", text: "done" }];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  expect(lastFrame()).toContain("✓ done");
});

test("renders error with ✗ prefix", () => {
  const items: ScrollbackItem[] = [{ id: "1", type: "error", text: "boom" }];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  expect(lastFrame()).toContain("✗ boom");
});

test("renders divider as a horizontal rule line", () => {
  const items: ScrollbackItem[] = [{ id: "1", type: "divider" }];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  expect(lastFrame()).toMatch(/─+/);
});

test("renders multiple items in order", () => {
  const items: ScrollbackItem[] = [
    { id: "1", type: "user_input", text: "first" },
    { id: "2", type: "assistant_text", text: "second" },
  ];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  const out = lastFrame() ?? "";
  expect(out.indexOf("first")).toBeLessThan(out.indexOf("second"));
});

// ── plan_summary ─────────────────────────────────────────────────────────────

const basePlan: ProjectPlanView = {
  planId: "plan_1",
  goal: "add auth module",
  questions: ["Use JWT?", "Session TTL?"],
  answers: ["yes"],
  tasks: [
    { id: "t1", title: "implement JWT", target: "codex", model: "gpt-5", effort: "medium", mode: "patch", status: "pending" },
  ],
};

test("renders plan_summary with goal", () => {
  const items: ScrollbackItem[] = [{ id: "1", type: "plan_summary", plan: basePlan }];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  expect(lastFrame()).toContain("add auth module");
});

test("renders plan_summary task row", () => {
  const items: ScrollbackItem[] = [{ id: "1", type: "plan_summary", plan: basePlan }];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  expect(lastFrame()).toContain("implement JWT");
});

test("renders plan_summary answered question with checkmark", () => {
  const items: ScrollbackItem[] = [{ id: "1", type: "plan_summary", plan: basePlan }];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  const frame = lastFrame() ?? "";
  expect(frame).toContain("✓");
  expect(frame).toContain("Use JWT?");
});

test("renders plan_summary unanswered question with number", () => {
  const items: ScrollbackItem[] = [{ id: "1", type: "plan_summary", plan: basePlan }];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  expect(lastFrame()).toContain("Session TTL?");
});

// ── plan_report ──────────────────────────────────────────────────────────────

const baseReport: PlanReportData = {
  plan_id: "plan_1",
  goal: "add search endpoint",
  generated_at: "2026-05-19T00:00:00.000Z",
  summary: { total: 2, completed: 2, failed: 0, blocked: 0, pending: 0 },
  tasks: [
    { id: "t1", title: "implement GET /search", status: "completed", result_summary: "route added" },
    { id: "t2", title: "review handler", status: "completed" },
  ],
  markdown: "",
};

test("renders plan_report with goal", () => {
  const items: ScrollbackItem[] = [{ id: "1", type: "plan_report", data: baseReport }];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  expect(lastFrame()).toContain("add search endpoint");
});

test("renders plan_report completed summary count", () => {
  const items: ScrollbackItem[] = [{ id: "1", type: "plan_report", data: baseReport }];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  expect(lastFrame()).toContain("2 completed");
});

test("renders plan_report task titles", () => {
  const items: ScrollbackItem[] = [{ id: "1", type: "plan_report", data: baseReport }];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  const frame = lastFrame() ?? "";
  expect(frame).toContain("implement GET /search");
  expect(frame).toContain("review handler");
});

test("renders plan_report result_summary inline", () => {
  const items: ScrollbackItem[] = [{ id: "1", type: "plan_report", data: baseReport }];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  expect(lastFrame()).toContain("route added");
});

test("plan_summary appears before plan_report in mixed scrollback", () => {
  const items: ScrollbackItem[] = [
    { id: "1", type: "plan_summary", plan: basePlan },
    { id: "2", type: "plan_report", data: baseReport },
  ];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  const out = lastFrame() ?? "";
  expect(out.indexOf("add auth module")).toBeLessThan(out.indexOf("add search endpoint"));
});
