import { test, expect, describe } from "bun:test";
import { render } from "ink-testing-library";
import { PlanReport } from "./PlanReport.js";
import type { PlanReportData } from "../../project_plan.js";

function makeReport(overrides: Partial<PlanReportData> = {}): PlanReportData {
  return {
    plan_id: "plan_test",
    goal: "add search endpoint",
    generated_at: "2026-05-19T00:00:00.000Z",
    summary: { total: 2, completed: 1, failed: 0, blocked: 0, pending: 1 },
    tasks: [
      { id: "t1", title: "implement GET /search", status: "completed", handoff_id: "h_abc" },
      { id: "t2", title: "review handler", status: "pending" },
    ],
    markdown: "",
    ...overrides,
  };
}

describe("PlanReport", () => {
  test("renders goal in heading", () => {
    const { lastFrame } = render(<PlanReport data={makeReport()} />);
    expect(lastFrame()).toContain("add search endpoint");
  });

  test("renders generated_at timestamp", () => {
    const { lastFrame } = render(<PlanReport data={makeReport()} />);
    expect(lastFrame()).toContain("2026-05-19T00:00:00.000Z");
  });

  test("renders summary counts — completed", () => {
    const { lastFrame } = render(<PlanReport data={makeReport()} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("1 completed");
    expect(frame).toContain("2 tasks");
  });

  test("renders per-task id and title", () => {
    const { lastFrame } = render(<PlanReport data={makeReport()} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("t1");
    expect(frame).toContain("implement GET /search");
    expect(frame).toContain("t2");
    expect(frame).toContain("review handler");
  });

  test("renders task status in brackets", () => {
    const { lastFrame } = render(<PlanReport data={makeReport()} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[completed]");
    expect(frame).toContain("[pending]");
  });

  test("renders result_summary when present", () => {
    const report = makeReport({
      tasks: [
        {
          id: "t1",
          title: "implement GET /search",
          status: "completed",
          handoff_id: "h_abc",
          result_summary: "added route, 3 tests passing",
        },
      ],
    });
    const { lastFrame } = render(<PlanReport data={report} />);
    expect(lastFrame()).toContain("added route, 3 tests passing");
  });

  test("renders needs_review flag when true", () => {
    const report = makeReport({
      tasks: [
        {
          id: "t1",
          title: "implement GET /search",
          status: "completed",
          needs_review: true,
        },
      ],
    });
    const { lastFrame } = render(<PlanReport data={report} />);
    expect(lastFrame()).toContain("needs review");
  });

  test("does NOT render needs_review flag when false/absent", () => {
    const { lastFrame } = render(<PlanReport data={makeReport()} />);
    expect(lastFrame()).not.toContain("needs review");
  });

  test("renders blocker lines when present", () => {
    const report = makeReport({
      tasks: [
        {
          id: "t1",
          title: "implement GET /search",
          status: "blocked",
          blockers: ["type errors in src/api.ts", "missing env var DB_URL"],
        },
      ],
    });
    const { lastFrame } = render(<PlanReport data={report} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("type errors in src/api.ts");
    expect(frame).toContain("missing env var DB_URL");
  });

  test("renders failed count in summary when non-zero", () => {
    const report = makeReport({
      summary: { total: 2, completed: 1, failed: 1, blocked: 0, pending: 0 },
    });
    const { lastFrame } = render(<PlanReport data={report} />);
    expect(lastFrame()).toContain("1 failed");
  });

  test("does NOT render failed count when zero", () => {
    const { lastFrame } = render(<PlanReport data={makeReport()} />);
    expect(lastFrame()).not.toContain("failed");
  });

  test("renders blocked count in summary when non-zero", () => {
    const report = makeReport({
      summary: { total: 1, completed: 0, failed: 0, blocked: 1, pending: 0 },
    });
    const { lastFrame } = render(<PlanReport data={report} />);
    expect(lastFrame()).toContain("1 blocked");
  });

  test("renders pending count in summary when non-zero", () => {
    const { lastFrame } = render(<PlanReport data={makeReport()} />);
    expect(lastFrame()).toContain("1 pending");
  });
});
