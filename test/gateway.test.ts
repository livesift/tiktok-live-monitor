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

class LifecycleProvider implements LiveProvider {
  private handler: ProviderEventHandler | undefined;

  async connect(username: string): Promise<LiveSession> {
    const base = {
      platform: "tiktok" as const,
      occurredAt: "2026-09-20T01:00:00Z",
      receivedAt: "2026-09-20T01:00:01Z",
      session: { id: "session-lifecycle-webhook", roomId: "room-lifecycle-webhook" },
      creator: { username },
    };
    this.handler?.({
      ...base,
      id: "event-started-webhook",
      type: "session_started",
      data: { startedAt: "2026-09-20T01:00:00Z" },
    });
    this.handler?.({
      ...base,
      id: "event-comment-webhook",
      type: "comment",
      data: { text: "hello" },
    });
    this.handler?.({
      ...base,
      id: "event-ended-webhook",
      type: "session_ended",
      occurredAt: "2026-09-20T01:01:00Z",
      data: {
        startedAt: "2026-09-20T01:00:00Z",
        endedAt: "2026-09-20T01:01:00Z",
        reason: "stream_end",
      },
    });
    return { username, roomId: "room-lifecycle-webhook" };
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

  it("prefers an explicit webhook URL over the Gateway URL and sends once", async () => {
    const fetchImpl = vi.fn(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
        expect(String(input)).toBe("https://hooks.example.test/live");
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token");
        return new Response(null, { status: 204 });
      },
    );

    const exitCode = await runCli(
      [
        "creator",
        "--webhook",
        "https://hooks.example.test/live",
        "--webhook-header",
        "Authorization: Bearer token",
      ],
      {
        provider: new EmittingProvider(),
        stdout: writer(),
        stderr: writer(),
        keepAlive: false,
        gatewayUrl: "http://localhost:8080",
        gatewayFetch: fetchImpl,
      },
    );

    expect(exitCode).toBe(0);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("keeps the session alive and closes local output when Webhook delivery fails", async () => {
    const fetchImpl = vi.fn(
      async (): Promise<Response> =>
        new Response(JSON.stringify({ error: { message: "endpoint down" } }), { status: 503 }),
    );
    const stdout = writer();
    const stderr = writer();

    const exitCode = await runCli(
      ["--json", "creator", "--webhook", "https://hooks.example.test/live"],
      {
        provider: new LifecycleProvider(),
        stdout,
        stderr,
        gatewayFetch: fetchImpl,
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout.write.mock.calls.map(([line]) => JSON.parse(line).type)).toEqual([
      "session_started",
      "comment",
      "session_ended",
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(9);
    expect(stderr.write.mock.calls.map(([line]) => line).join("")).toContain(
      "Webhook rejected event event-ended-webhook",
    );
  });
});
