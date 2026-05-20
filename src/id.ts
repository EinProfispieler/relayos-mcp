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
