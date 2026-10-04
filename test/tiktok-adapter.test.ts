import { describe, expect, it, vi } from "vitest";
import { InvalidUniqueIdError, UserOfflineError, WebcastEvent } from "tiktok-live-connector";
import { TikTokLiveConnectorProvider } from "../src/providers/tiktok-live-connector/provider.js";

class FakeTikTokClient {
  readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
  connect = vi.fn(async () => ({ roomId: "room-456" }));
  disconnect = vi.fn(async () => undefined);

  on(event: string, handler: (payload: unknown) => void): void {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(handler);
    this.handlers.set(event, handlers);
  }

  removeListener(event: string, handler: (payload: unknown) => void): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

describe("TikTokLiveConnectorProvider", () => {
  it("normalizes the username before creating the provider client", async () => {
    const client = new FakeTikTokClient();
    const clientFactory = vi.fn(() => client);
    const provider = new TikTokLiveConnectorProvider({ clientFactory });

    await expect(provider.connect("@creator")).resolves.toEqual({
      username: "creator",
      roomId: "room-456",
      sessionId: expect.any(String),
    });
    expect(clientFactory).toHaveBeenCalledWith("creator");
    expect(client.connect).toHaveBeenCalledOnce();
  });

  it("rejects a malformed username before creating a provider client", async () => {
    const clientFactory = vi.fn(() => new FakeTikTokClient());
    const provider = new TikTokLiveConnectorProvider({ clientFactory });

    await expect(provider.connect("creator name")).rejects.toMatchObject({
      code: "INVALID_USERNAME",
      message: "Username must be 1-24 letters, numbers, dots, underscores, or hyphens.",
    });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it("maps the provider offline error to a domain error", async () => {
    const client = new FakeTikTokClient();
    client.connect.mockRejectedValueOnce(new UserOfflineError("offline"));
    const provider = new TikTokLiveConnectorProvider({
      clientFactory: () => client,
    });

    await expect(provider.connect("creator")).rejects.toMatchObject({
      code: "OFFLINE",
      message: "@creator is currently offline.",
    });
  });

  it("maps an unrecognized provider username to a domain error", async () => {
    const client = new FakeTikTokClient();
    client.connect.mockRejectedValueOnce(new InvalidUniqueIdError("not found"));
    const clientFactory = vi.fn(() => client);
    const provider = new TikTokLiveConnectorProvider({ clientFactory });

    await expect(provider.connect("creator")).rejects.toMatchObject({
      code: "INVALID_USERNAME",
      message: "Unable to recognize TikTok username @creator.",
    });
    expect(clientFactory).toHaveBeenCalledWith("creator");
  });

  it("maps unknown provider failures to a readable connection error", async () => {
    const client = new FakeTikTokClient();
    client.connect.mockRejectedValueOnce(
      new Error("socket closed\n    at hiddenConnection (secret.ts:1:1)"),
    );
    const provider = new TikTokLiveConnectorProvider({
      clientFactory: () => client,
    });

    await expect(provider.connect("creator")).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
      message: "Unable to connect to @creator: socket closed",
    });
  });

  it("does not emit lifecycle events when the room ID is invalid and cleans up the client", async () => {
    const client = new FakeTikTokClient();
    client.connect.mockResolvedValueOnce({ roomId: "" });
    const provider = new TikTokLiveConnectorProvider({ clientFactory: () => client });
    const handler = vi.fn();

    provider.onEvent(handler);
    await expect(provider.connect("creator")).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
      message: "The provider did not return a valid room ID.",
    });

    expect(handler).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledOnce();
    await provider.disconnect();
    expect(client.disconnect).toHaveBeenCalledOnce();
  });

  it("normalizes disconnect failures and keeps repeated disconnects idempotent", async () => {
    const client = new FakeTikTokClient();
    client.disconnect.mockRejectedValueOnce(
      new Error("socket closed\n    at hiddenCleanup (secret.ts:1:1)"),
    );
    const provider = new TikTokLiveConnectorProvider({ clientFactory: () => client });

    await provider.connect("creator");
    await expect(provider.disconnect()).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
      message: "Unable to connect to @creator: socket closed",
    });
    await provider.disconnect();

    expect(client.disconnect).toHaveBeenCalledOnce();
  });

  it("converts provider events to the provider-independent event shape", async () => {
    const client = new FakeTikTokClient();
    const provider = new TikTokLiveConnectorProvider({
      clientFactory: () => client,
    });
    const handler = vi.fn();

    provider.onEvent(handler);
    const connected = await provider.connect("creator");
    const startedSessionId = handler.mock.calls[0]?.[0].session.id;
    expect(startedSessionId).toEqual(expect.any(String));
    expect(connected.sessionId).toBe(startedSessionId);
    handler.mockClear();
    client.emit(WebcastEvent.CHAT, {
      common: { createTime: "1726794123000" },
      content: "hello",
      user: { id: "user-1", displayId: "viewer", nickname: "Viewer" },
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "tiktok",
        type: "comment",
        occurredAt: "2024-09-20T01:02:03.000Z",
        session: expect.objectContaining({ roomId: "room-456" }),
        creator: { username: "creator" },
        actor: { userId: "user-1", username: "viewer", nickname: "Viewer" },
        data: { text: "hello" },
        raw: expect.any(Object),
      }),
    );
    expect(handler.mock.calls[0]?.[0].session.id).toBe(startedSessionId);
  });

  it("ignores provider events that are outside the LiveEvent contract", async () => {
    const client = new FakeTikTokClient();
    const provider = new TikTokLiveConnectorProvider({
      clientFactory: () => client,
    });
    const handler = vi.fn();

    provider.onEvent(handler);
    await provider.connect("creator");
    handler.mockClear();
    client.emit(WebcastEvent.SYSTEM, { message: "unsupported" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("emits normalized session lifecycle events", async () => {
    const client = new FakeTikTokClient();
    const provider = new TikTokLiveConnectorProvider({
      clientFactory: () => client,
    });
    const handler = vi.fn();

    provider.onEvent(handler);
    await provider.connect("creator");
    await provider.disconnect();

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session_started",
        data: { startedAt: expect.any(String) },
      }),
    );
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session_ended",
        data: {
          startedAt: expect.any(String),
          endedAt: expect.any(String),
          reason: "stream_end",
        },
      }),
    );
  });

  it("does not duplicate session_ended after a provider stream end", async () => {
    const client = new FakeTikTokClient();
    const provider = new TikTokLiveConnectorProvider({
      clientFactory: () => client,
      clock: () => new Date("2026-09-20T01:00:00Z"),
      idFactory: () => "session-one",
    });
    const handler = vi.fn();

    provider.onEvent(handler);
    await provider.connect("creator");
    client.emit(WebcastEvent.STREAM_END, {
      common: { createTime: "2026-09-20T02:00:00Z" },
    });
    await provider.disconnect();

    const lifecycleEvents = handler.mock.calls
      .map(([event]) => event)
      .filter((event) => event.type === "session_started" || event.type === "session_ended");
    expect(lifecycleEvents.map((event) => event.type)).toEqual([
      "session_started",
      "session_ended",
    ]);
    expect(lifecycleEvents[0].session).toEqual(lifecycleEvents[1].session);
  });

  it("does not emit lifecycle events when connection fails", async () => {
    const client = new FakeTikTokClient();
    client.connect.mockRejectedValueOnce(new Error("socket closed"));
    const provider = new TikTokLiveConnectorProvider({ clientFactory: () => client });
    const handler = vi.fn();

    provider.onEvent(handler);
    await expect(provider.connect("creator")).rejects.toThrow("Unable to connect");

    expect(handler).not.toHaveBeenCalled();
  });
});
