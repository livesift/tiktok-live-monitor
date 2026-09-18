import { MonitorError } from "./errors.js";

const CREATOR_USERNAME_PATTERN = /^[A-Za-z0-9._-]{1,24}$/;

export function normalizeCreatorUsername(input: string): string {
  const normalized = input.trim().replace(/^@/, "");

  if (!CREATOR_USERNAME_PATTERN.test(normalized)) {
    throw new MonitorError(
      "INVALID_USERNAME",
      "Username must be 1-24 letters, numbers, dots, underscores, or hyphens.",
    );
  }

  return normalized;
}
