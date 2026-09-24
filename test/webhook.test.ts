import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseWebhookHeader, WebhookEventSink, type WebhookHeader } from "../src/sinks/webhook.js";
import type { LiveEvent } from "../src/events/types.js";
import { createMockWebhookServer } from "./support/mock-webhook.js";

const fixturePath = resolve(
  fileURLToPath(new URL("./fixtures/webhook-event.json", import.meta.url)),
);
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as LiveEvent;

describe("WebhookEventSink", () => {
  it("posts the LiveEvent payload and repeated headers to the mock server", async () => {
    const server = await createMockWebhookServer();
    try {
      const headers: WebhookHeader[] = [
        parseWebhookHeader("Authorization: Bearer token"),
        parseWebhookHeader("X-Source: livesift"),
      ];
      const sink = new WebhookEventSink(server.url, { headers });

      await sink.write(fixture);
      await sink.close();

      expect(server.requests).toHaveLength(1);
      expect(server.requests[0]).toMatchObject({ method: "POST", url: "/events" });
      expect(server.requests[0]?.headers.authorization).toBe("Bearer token");
      expect(server.requests[0]?.headers["x-source"]).toBe("livesift");
      expect(JSON.parse(server.requests[0]?.body ?? "")).toEqual(fixture);
    } finally {
      await server.close();
    }
  });

  it("rejects invalid headers and protects Content-Type", () => {
    expect(() => parseWebhookHeader("Authorization")).toThrow('"Name: value"');
    expect(() => parseWebhookHeader("Authorization:")).toThrow("non-empty");
    expect(() => parseWebhookHeader("Content-Type: text/plain")).toThrow("Content-Type");
    expect(
      () =>
        new WebhookEventSink("https://example.test/events", {
          headers: [{ name: "Content-Type", value: "text/plain" }],
        }),
    ).toThrow("Content-Type");
    expect(() => new WebhookEventSink("ftp://example.test/events")).toThrow("http or https");
  });

  it("retries transient failures with exponential delays and stops after success", async () => {
    const statuses = [503, 503, 204];
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>(async () => undefined);
    const fetchImpl = vi.fn(async () => new Response(null, { status: statuses.shift() ?? 500 }));
    const errors: Error[] = [];
    const sink = new WebhookEventSink("https://example.test/events", {
      fetchImpl,
      retryDelayMs: 10,
      sleep,
      onError: (error) => errors.push(error),
    });

    await sink.write(fixture);
    await sink.close();

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([10, 20]);
    expect(errors).toEqual([]);
  });

  it("records a final failure without rejecting the sink write", async () => {
    const errors: Error[] = [];
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: "down" } }), { status: 503 }),
    );
    const sink = new WebhookEventSink("https://example.test/events", {
      fetchImpl,
      retryDelayMs: 0,
      onError: (error) => errors.push(error),
    });

    await expect(sink.write(fixture)).resolves.toBeUndefined();
    await sink.close();

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("evt-webhook-fixture");
    expect(errors[0]?.message).toContain("https://example.test/events");
  });

  it("waits for queued delivery before close and preserves request order", async () => {
    let releaseFirst: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as LiveEvent;
      calls.push(body.id);
      if (body.id === fixture.id) {
        await first;
      }
      return new Response(null, { status: 204 });
    });
    const second = { ...fixture, id: "evt-webhook-second" } satisfies LiveEvent;
    const sink = new WebhookEventSink("https://example.test/events", { fetchImpl });
    const firstWrite = sink.write(fixture);
    const secondWrite = sink.write(second);
    const closing = sink.close();

    await Promise.resolve();
    expect(calls).toEqual([fixture.id]);
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);

    releaseFirst?.();
    await Promise.all([firstWrite, secondWrite, closing]);
    expect(calls).toEqual([fixture.id, second.id]);
    expect(closed).toBe(true);
  });

  it("converts an abort timeout into a best-effort diagnostic", async () => {
    const errors: Error[] = [];
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      await new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
      throw new Error("unreachable");
    });
    const sink = new WebhookEventSink("https://example.test/events", {
      fetchImpl,
      timeoutMs: 5,
      maxAttempts: 1,
      onError: (error) => errors.push(error),
    });

    await expect(sink.write(fixture)).resolves.toBeUndefined();
    expect(errors[0]?.message).toContain("aborted");
  });
});
