import { InvalidUniqueIdError, UserOfflineError, WebcastEvent } from "tiktok-live-connector";
import { MonitorError } from "../../core/errors.js";
import type { LiveSession, ProviderEvent } from "../../core/provider.js";

export function getWebcastEventNames(): string[] {
  return Object.values(WebcastEvent).map((event) => String(event));
}

export function normalizeLiveSession(username: string, roomId: string | number): LiveSession {
  const normalizedRoomId = String(roomId).trim();

  if (normalizedRoomId === "") {
    throw new MonitorError("CONNECTION_FAILED", "The provider did not return a valid room ID.");
  }

  return { username, roomId: normalizedRoomId };
}

export function normalizeProviderEvent(type: string, payload: unknown): ProviderEvent {
  return { type, payload };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : "Unknown connection error.";
}

export function normalizeTikTokError(error: unknown, username: string): MonitorError {
  if (error instanceof UserOfflineError) {
    return new MonitorError("OFFLINE", `@${username} is currently offline.`, { cause: error });
  }

  if (error instanceof InvalidUniqueIdError) {
    return new MonitorError(
      "INVALID_USERNAME",
      `Unable to recognize TikTok username @${username}.`,
      {
        cause: error,
      },
    );
  }

  if (error instanceof MonitorError) {
    return error;
  }

  return new MonitorError(
    "CONNECTION_FAILED",
    `Unable to connect to @${username}: ${getErrorMessage(error)}`,
    {
      cause: error,
    },
  );
}
