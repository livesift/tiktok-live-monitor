import type { LiveEvent } from "../events/types.js";

export function serializeJsonlEvent(event: LiveEvent): string {
  const serialized = JSON.stringify(event);
  if (typeof serialized !== "string") {
    throw new TypeError("LiveEvent could not be serialized as JSON.");
  }

  return `${serialized}\n`;
}
