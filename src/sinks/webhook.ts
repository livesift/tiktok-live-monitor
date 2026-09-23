import type { LiveEvent } from "../events/types.js";
import { serializeJsonlEvent } from "./jsonl.js";
import type { EventSink } from "./output.js";

export interface WebhookHeader {
  name: string;
  value: string;
}

export interface WebhookEventSinkOptions {
  fetchImpl?: typeof fetch;
  headers?: readonly WebhookHeader[];
  onError?: (error: Error) => void;
  errorLabel?: string;
  includeEndpointInError?: boolean;
  maxAttempts?: number;
  retryDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  maxQueueSize?: number;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function validateWebhookEndpoint(endpoint: string): string {
  const value = endpoint.trim();
  if (value === "") {
    throw new Error("Webhook URL must not be empty.");
  }

  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Webhook URL must use http or https.");
  }

  return url.toString();
}

export function parseWebhookHeader(rawHeader: string): WebhookHeader {
  const separator = rawHeader.indexOf(":");
  if (separator <= 0) {
    throw new Error('Webhook header must use the "Name: value" format.');
  }

  const name = rawHeader.slice(0, separator).trim();
  const value = rawHeader.slice(separator + 1).trim();
  if (name === "" || value === "") {
    throw new Error('Webhook header must include a non-empty name and value.');
  }
  if (name.toLowerCase() === "content-type") {
    throw new Error("Webhook header must not override Content-Type.");
  }

  try {
    const headers = new Headers();
    headers.append(name, value);
  } catch (error) {
    throw new Error(`Invalid webhook header: ${asError(error).message}`, { cause: error });
  }

  return { name, value };
}

async function responseFailure(
  response: Response,
  label: string,
  endpoint: string,
  eventId: string,
  includeEndpoint: boolean,
): Promise<Error> {
  let detail = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as {
      error?: { message?: unknown };
    };
    if (typeof body.error?.message === "string" && body.error.message.trim() !== "") {
      detail = body.error.message;
    }
  } catch {
    // 非 JSON 响应只保留 HTTP 状态，避免扩散第三方原始响应。
  }

  const target = includeEndpoint ? ` at ${endpoint}` : "";
  return new Error(`${label} rejected event ${eventId}${target}: ${detail}`);
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class WebhookEventSink implements EventSink {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly headers: Headers;
  private readonly onError: (error: Error) => void;
  private readonly errorLabel: string;
  private readonly includeEndpointInError: boolean;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly maxQueueSize: number;
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private closed = false;
  private closePromise: Promise<void> | undefined;

  constructor(endpoint: string, options: WebhookEventSinkOptions = {}) {
    this.endpoint = validateWebhookEndpoint(endpoint);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.headers = new Headers({ "Content-Type": "application/json" });
    for (const header of options.headers ?? []) {
      if (header.name.trim() === "" || header.value.trim() === "") {
        throw new Error("Webhook header must include a non-empty name and value.");
      }
      if (header.name.toLowerCase() === "content-type") {
        throw new Error("Webhook header must not override Content-Type.");
      }
      this.headers.append(header.name, header.value);
    }
    this.onError = options.onError ?? (() => undefined);
    this.errorLabel = options.errorLabel ?? "Webhook";
    this.includeEndpointInError = options.includeEndpointInError ?? true;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 100;
    this.sleep = options.sleep ?? defaultSleep;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxQueueSize = options.maxQueueSize ?? 256;

    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1) {
      throw new Error("Webhook maxAttempts must be a positive integer.");
    }
    if (!Number.isFinite(this.retryDelayMs) || this.retryDelayMs < 0) {
      throw new Error("Webhook retryDelayMs must be non-negative.");
    }
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("Webhook timeoutMs must be positive.");
    }
    if (!Number.isInteger(this.maxQueueSize) || this.maxQueueSize < 1) {
      throw new Error("Webhook maxQueueSize must be a positive integer.");
    }
  }

  async write(event: LiveEvent): Promise<void> {
    if (this.closed) {
      this.report(new Error(`${this.errorLabel} sink is already closed.`));
      return;
    }
    if (this.pending >= this.maxQueueSize) {
      this.report(new Error(`${this.errorLabel} queue is full; dropped event ${event.id}.`));
      return;
    }

    this.pending += 1;
    const delivery = this.queue
      .then(() => this.deliver(event))
      .catch((error: unknown) => {
        this.report(asError(error));
      })
      .finally(() => {
        this.pending -= 1;
      });
    this.queue = delivery;
    return delivery;
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) {
      return this.closePromise;
    }
    this.closed = true;
    this.closePromise = this.queue;
    return this.closePromise;
  }

  private async deliver(event: LiveEvent): Promise<void> {
    let body: string;
    try {
      body = serializeJsonlEvent(event).slice(0, -1);
    } catch (error) {
      this.report(asError(error));
      return;
    }

    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await this.request(body);
        if (response.ok) {
          return;
        }
        lastError = await responseFailure(
          response,
          this.errorLabel,
          this.endpoint,
          event.id,
          this.includeEndpointInError,
        );
      } catch (error) {
        lastError = asError(error);
      }

      if (attempt < this.maxAttempts) {
        await this.sleep(this.retryDelayMs * 2 ** (attempt - 1));
      }
    }

    if (lastError !== undefined) {
      this.report(lastError);
    }
  }

  private async request(body: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: this.headers,
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private report(error: Error): void {
    try {
      this.onError(error);
    } catch {
      // 诊断输出失败也不能把 best-effort Webhook 升级为致命 sink 错误。
    }
  }
}
