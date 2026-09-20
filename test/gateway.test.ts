import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli/index.js";
import type { LiveProvider, LiveSession, ProviderEventHandler } from "../src/core/provider.js";
import { GatewayEventClient } from "../src/events/gateway.js";

const event = {
  id: "evt-gateway-test",
  platform: "tiktok" as const,
  type: "comment" as const,
  occurredAt: "2026-09-20T01:02:03Z",
  receivedAt: "2026-09-20T01:02:04Z",
  session: { id: "session-gateway-test" },
  creator: { username: "creator" },
  data: { text: "hello" },
};

class EmittingProvider implements LiveProvider {
  private handler: ProviderEventHandler | undefined;

  async connect(username: string): Promise<LiveSession> {
    this.handler?.(event);
    return { username, roomId: "room-gateway-test" };
  }

  async disconnect(): Promise<void> {}

  onEvent(handler: ProviderEventHandler): void {
    this.handler = handler;
  }
}

function writer() {
  return { write: vi.fn<(message: string) => void>() };
}

describe("Gateway event delivery", () => {
  it("posts a LiveEvent to the Gateway events endpoint", async () => {
    const fetchImpl = vi.fn(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
        expect(String(input)).toBe("http://localhost:8080/v1/events");
        expect(init?.method).toBe("POST");
        expect(init?.headers).toEqual({ "Content-Type": "application/json" });
        expect(JSON.parse(String(init?.body))).toEqual(event);
        return new Response(null, { status: 200 });
      },
    );

    await new GatewayEventClient("http://localhost:8080", { fetchImpl }).send(event);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("sends normalized provider events from runCli when Gateway is configured", async () => {
    const fetchImpl = vi.fn(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
        expect(String(input)).toBe("http://localhost:8080/v1/events");
        expect(JSON.parse(String(init?.body))).toEqual(event);
        return new Response(null, { status: 200 });
      },
    );
    const stdout = writer();
    const stderr = writer();

    const exitCode = await runCli(["creator"], {
      provider: new EmittingProvider(),
      stdout,
      stderr,
      keepAlive: false,
      gatewayUrl: "http://localhost:8080",
      gatewayFetch: fetchImpl,
    });

    expect(exitCode).toBe(0);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(stderr.write).not.toHaveBeenCalled();
  });

  it("reports Gateway rejection without throwing out of the monitor", async () => {
    const fetchImpl = vi.fn(
      async (): Promise<Response> =>
        new Response(JSON.stringify({ error: { message: "id is required" } }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const stderr = writer();

    const exitCode = await runCli(["creator"], {
      provider: new EmittingProvider(),
      stdout: writer(),
      stderr,
      keepAlive: false,
      gatewayUrl: "http://localhost:8080",
      gatewayFetch: fetchImpl,
    });

    expect(exitCode).toBe(0);
    expect(stderr.write).toHaveBeenCalledWith(
      "Gateway rejected event evt-gateway-test: id is required\n",
    );
  });
});
