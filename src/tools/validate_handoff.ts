import { HandoffInput } from "../schema.js";

export interface ValidateOk {
  ok: true;
  normalized: HandoffInput;
}

export interface ValidateError {
  ok: false;
  issues: Array<{ path: string; message: string }>;
}

export function validateHandoff(rawInput: unknown): ValidateOk | ValidateError {
  const result = HandoffInput.safeParse(rawInput);
  if (result.success) {
    return { ok: true, normalized: result.data };
  }
  return {
    ok: false,
    issues: result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })),
  };
}
