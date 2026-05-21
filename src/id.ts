import { ulid } from "ulid";

export function newHandoffId(): string {
  return `h_${ulid()}`;
}

export function isHandoffId(value: string): boolean {
  return /^h_[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

export function newCheckpointId(): string {
  return `c_${ulid()}`;
}

export function isCheckpointId(value: string): boolean {
  return /^c_[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

export function newRunId(): string {
  return `r_${ulid()}`;
}

export function isRunId(value: string): boolean {
  return /^r_[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

export function newExecutionWorkspaceId(): string {
  return `w_${ulid()}`;
}

export function isExecutionWorkspaceId(value: string): boolean {
  return /^w_[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

// ── Review / Repair layer (Plan §2.8–§2.13) ──────────────────────────
// Every ID has a stable short prefix so a record's family is obvious
// at a glance and so router/dispatch code can branch on it without
// loading the full payload.

export function newReviewFindingId(): string {
  return `f_${ulid()}`;
}

export function isReviewFindingId(value: string): boolean {
  return /^f_[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

export function newRepairAttemptId(): string {
  return `a_${ulid()}`;
}

export function isRepairAttemptId(value: string): boolean {
  return /^a_[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

export function newRepairDecisionId(): string {
  return `d_${ulid()}`;
}

export function isRepairDecisionId(value: string): boolean {
  return /^d_[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

export function newDraftReplyId(): string {
  return `dr_${ulid()}`;
}

export function isDraftReplyId(value: string): boolean {
  return /^dr_[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

export function newBatchReportId(): string {
  return `br_${ulid()}`;
}

export function isBatchReportId(value: string): boolean {
  return /^br_[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

export function newReviewPassId(): string {
  return `rp_${ulid()}`;
}

export function isReviewPassId(value: string): boolean {
  return /^rp_[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

export function newUserApprovalId(): string {
  return `ua_${ulid()}`;
}

export function isUserApprovalId(value: string): boolean {
  return /^ua_[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

export function newReplySentId(): string {
  return `rs_${ulid()}`;
}

export function isReplySentId(value: string): boolean {
  return /^rs_[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

export function newResultId(): string {
  return `res_${ulid()}`;
}

export function isResultId(value: string): boolean {
  return /^res_[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}
