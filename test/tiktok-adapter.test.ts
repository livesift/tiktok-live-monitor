import { describe, expect, it, vi } from "vitest";
import { UserOfflineError, WebcastEvent } from "tiktok-live-connector";
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
    });
    expect(clientFactory).toHaveBeenCalledWith("creator");
    expect(client.connect).toHaveBeenCalledOnce();
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

  it("maps unknown provider failures to a readable connection error", async () => {
    const client = new FakeTikTokClient();
    client.connect.mockRejectedValueOnce(new Error("socket closed"));
    const provider = new TikTokLiveConnectorProvider({
      clientFactory: () => client,
    });

    await expect(provider.connect("creator")).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
      message: "Unable to connect to @creator: socket closed",
    });
  });

  it("converts provider events to the provider-independent event shape", async () => {
    const client = new FakeTikTokClient();
    const provider = new TikTokLiveConnectorProvider({
      clientFactory: () => client,
    });
    const handler = vi.fn();

    provider.onEvent(handler);
    await provider.connect("creator");
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
        data: {},
      }),
    );
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session_ended",
        data: { reason: "stream_end" },
      }),
    );
  });
});
