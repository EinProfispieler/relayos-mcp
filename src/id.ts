import { ulid } from "ulid";

export function newHandoffId(): string {
  return `h_${ulid()}`;
}

export function isHandoffId(value: string): boolean {
  return /^h_[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}
