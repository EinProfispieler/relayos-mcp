import type { AIRoutingPlan } from "./schema.js";

export interface ActionProposal {
  action: "create_handoff" | "review_request" | "request_approval" | "local_plan" | "unknown";
  target?: string;
  model?: string;
  effort?: string;
  mode?: string;
  approval_required?: boolean;
  status: "not_executed" | "blocked_until_user_approval";
}

function looksLikeReleaseControl(nextAction: string): boolean {
  return /(commit|push|tag|release)/i.test(nextAction);
}

export function buildActionProposal(plan: AIRoutingPlan): ActionProposal {
  if (plan.task_type === "release_control" || plan.task_type === "release" || looksLikeReleaseControl(plan.next_action)) {
    return {
      action: "request_approval",
      target: "approval",
      mode: "release_control",
      approval_required: true,
      status: "blocked_until_user_approval",
    };
  }

  // Honor an explicit approval gate from the planner regardless of task type.
  if (plan.approval_required) {
    return {
      action: "request_approval",
      target: "approval",
      mode: plan.mode,
      approval_required: true,
      status: "blocked_until_user_approval",
    };
  }

  if (plan.task_type === "implementation") {
    return {
      action: "create_handoff",
      target: "codex",
      model: plan.model,
      effort: plan.effort,
      mode: plan.mode,
      approval_required: false,
      status: "not_executed",
    };
  }

  if (plan.task_type === "review") {
    return {
      action: "review_request",
      target: "claude",
      model: plan.model,
      effort: plan.effort,
      mode: "read_only",
      approval_required: false,
      status: "not_executed",
    };
  }

  if (plan.task_type === "planning") {
    return {
      action: "local_plan",
      target: "local",
      mode: "plan",
      approval_required: false,
      status: "not_executed",
    };
  }

  return {
    action: "unknown",
    status: "not_executed",
  };
}
