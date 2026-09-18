import { describe, expect, it, vi } from "vitest";
import { UserOfflineError, WebcastEvent } from "tiktok-live-connector";
import { TikTokLiveTransport } from "../src/adapters/tiktok/client.js";

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

describe("TikTokLiveTransport", () => {
  it("normalizes the username before creating the provider client", async () => {
    const client = new FakeTikTokClient();
    const clientFactory = vi.fn(() => client);
    const transport = new TikTokLiveTransport("@creator", { clientFactory });

    await expect(transport.connect()).resolves.toEqual({ roomId: "room-456" });
    expect(clientFactory).toHaveBeenCalledWith("creator");
    expect(client.connect).toHaveBeenCalledOnce();
  });

  it("maps the provider offline error to a domain error", async () => {
    const client = new FakeTikTokClient();
    client.connect.mockRejectedValueOnce(new UserOfflineError("offline"));
    const transport = new TikTokLiveTransport("creator", {
      clientFactory: () => client,
    });

    await expect(transport.connect()).rejects.toMatchObject({
      code: "OFFLINE",
      message: "@creator is currently offline.",
    });
  });

  it("converts provider events to the provider-independent event shape", () => {
    const client = new FakeTikTokClient();
    const transport = new TikTokLiveTransport("creator", {
      clientFactory: () => client,
    });
    const handler = vi.fn();

    const removeHandler = transport.onEvent(handler);
    client.emit(WebcastEvent.CHAT, { comment: "hello" });
    removeHandler();
    client.emit(WebcastEvent.CHAT, { comment: "ignored" });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      type: WebcastEvent.CHAT,
      payload: { comment: "hello" },
    });
  });
});
