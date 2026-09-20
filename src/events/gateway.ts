import type { LiveEvent } from "./types.js";

export interface GatewayEventClientOptions {
  fetchImpl?: typeof fetch;
}

export class GatewayEventClient {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(gatewayUrl: string, options: GatewayEventClientOptions = {}) {
    this.endpoint = resolveGatewayEventsEndpoint(gatewayUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(event: LiveEvent): Promise<void> {
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });

    if (response.ok) {
      return;
    }

    let detail = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as {
        error?: { message?: unknown };
      };
      if (typeof body.error?.message === "string" && body.error.message.trim() !== "") {
        detail = body.error.message;
      }
    } catch {
      // 非 JSON 错误响应保留 HTTP 状态，避免把 Gateway 的原始内容扩散到 CLI。
    }

    throw new Error(`Gateway rejected event ${event.id}: ${detail}`);
  }
}

export function resolveGatewayEventsEndpoint(gatewayUrl: string): string {
  const url = new URL(gatewayUrl);
  const pathname = url.pathname.replace(/\/+$/, "");
  if (!pathname.endsWith("/v1/events")) {
    url.pathname = `${pathname}/v1/events`;
  }
  return url.toString();
}

export function gatewayUrlFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value = environment.LIVESIFT_GATEWAY_URL?.trim();
  return value === "" ? undefined : value;
}
