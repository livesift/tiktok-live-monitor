import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface MockWebhookRequest {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

export interface MockWebhookResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface MockWebhookServer {
  readonly url: string;
  readonly requests: MockWebhookRequest[];
  close(): Promise<void>;
}

export async function createMockWebhookServer(
  respond: (request: MockWebhookRequest, index: number) => MockWebhookResponse = () => ({
    status: 204,
  }),
): Promise<MockWebhookServer> {
  const requests: MockWebhookRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const item: MockWebhookRequest = {
        method: request.method ?? "",
        url: request.url ?? "/",
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      requests.push(item);
      writeResponse(response, respond(item, requests.length - 1));
    });
    request.on("error", () => response.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("Mock webhook server did not expose a TCP address.");
  }

  return {
    url: `http://127.0.0.1:${address.port}/events`,
    requests,
    close: () => closeServer(server),
  };
}

function writeResponse(response: ServerResponse, result: MockWebhookResponse): void {
  response.statusCode = result.status;
  for (const [name, value] of Object.entries(result.headers ?? {})) {
    response.setHeader(name, value);
  }
  if (result.body === undefined) {
    response.end();
    return;
  }
  if (response.getHeader("content-type") === undefined) {
    response.setHeader("Content-Type", "application/json");
  }
  response.end(typeof result.body === "string" ? result.body : JSON.stringify(result.body));
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
