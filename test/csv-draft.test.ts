import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";
import type { LiveEvent } from "../src/events/types.js";

const header = [
  "id",
  "platform",
  "type",
  "occurredAt",
  "receivedAt",
  "sessionId",
  "roomId",
  "creatorUsername",
  "creatorUserId",
  "creatorNickname",
  "actorUserId",
  "actorUsername",
  "actorNickname",
  "dataJson",
  "rawJson",
];
const sessionCsvPath = fileURLToPath(new URL("../examples/session.csv", import.meta.url));
const escapingCsvPath = fileURLToPath(
  new URL("../examples/session-csv-escaping.csv", import.meta.url),
);
const jsonlPath = fileURLToPath(new URL("../examples/session.jsonl", import.meta.url));

function parseCsv(input: string): string[][] {
  if (input.startsWith("\uFEFF")) {
    throw new Error("CSV must not contain a UTF-8 BOM.");
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let insideQuotes = false;
  let closedQuote = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;

    if (insideQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          insideQuotes = false;
          closedQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (closedQuote && character !== "," && character !== "\r") {
      throw new Error(`Unexpected character after a quoted field at offset ${index}.`);
    }

    if (character === '"') {
      if (field !== "" || closedQuote) {
        throw new Error(`Unexpected quote in an unquoted field at offset ${index}.`);
      }
      insideQuotes = true;
      continue;
    }

    if (character === ",") {
      row.push(field);
      field = "";
      closedQuote = false;
      continue;
    }

    if (character === "\r") {
      if (input[index + 1] !== "\n") {
        throw new Error(`Record separators must be CRLF at offset ${index}.`);
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      closedQuote = false;
      index += 1;
      continue;
    }

    if (character === "\n") {
      throw new Error(`Bare LF outside a quoted field at offset ${index}.`);
    }

    if (closedQuote) {
      throw new Error(`Unexpected character after a quoted field at offset ${index}.`);
    }
    field += character;
  }

  if (insideQuotes) {
    throw new Error("CSV ends inside a quoted field.");
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function scalar(value: string | undefined): string {
  return value ?? "";
}

describe("csv-draft-v1 examples", () => {
  it("keeps the fixed 15-column order and represents all nine core fixture events", async () => {
    const [csvText, jsonlText] = await Promise.all([
      readFile(sessionCsvPath, "utf8"),
      readFile(jsonlPath, "utf8"),
    ]);
    const rows = parseCsv(csvText);
    const events = jsonlText
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as LiveEvent);

    expect(csvText.charCodeAt(0)).not.toBe(0xfeff);
    expect(csvText.endsWith("\r\n")).toBe(true);
    expect(rows[0]).toEqual(header);
    expect(rows).toHaveLength(events.length + 1);

    for (const [index, event] of events.entries()) {
      const row = rows[index + 1]!;
      expect(row).toHaveLength(15);
      expect(row.slice(0, 13)).toEqual([
        event.id,
        event.platform,
        event.type,
        event.occurredAt,
        event.receivedAt,
        event.session.id,
        scalar(event.session.roomId),
        event.creator.username,
        scalar(event.creator.userId),
        scalar(event.creator.nickname),
        scalar(event.actor?.userId),
        scalar(event.actor?.username),
        scalar(event.actor?.nickname),
      ]);
      expect(JSON.parse(row[13]!)).toEqual(event.data);
      expect(row[14]).toBe(event.raw === undefined ? "" : JSON.stringify(event.raw));
      if (event.raw !== undefined) {
        expect(JSON.parse(row[14]!)).toEqual(event.raw);
      }
    }
  });

  it("recovers commas, doubled quotes, and embedded CRLF without losing explicit zero", async () => {
    const escapingRows = parseCsv(await readFile(escapingCsvPath, "utf8"));
    const escapingEvent = escapingRows[1]!;
    expect(escapingRows[0]).toEqual(header);
    expect(escapingRows).toHaveLength(2);
    expect(escapingEvent[12]).toBe('Viewer, "quoted"\r\nsecond line');
    expect(JSON.parse(escapingEvent[13]!)).toEqual({ text: 'Thanks, "viewer"\nnext line' });

    const zeroRow = [...header];
    const zeroValues = Array.from({ length: header.length }, () => "");
    zeroValues[0] = "zero-value-example";
    zeroValues[1] = "tiktok";
    zeroValues[2] = "viewer_count";
    zeroValues[13] = '{"viewerCount":0}';
    const parsedZeroRow = parseCsv(
      `${zeroRow.join(",")}\r\n${zeroValues.map(csvCell).join(",")}\r\n`,
    )[1]!;
    expect(parsedZeroRow[6]).toBe("");
    expect(JSON.parse(parsedZeroRow[13]!).viewerCount).toBe(0);
  });

  it("rejects malformed quote escaping and non-CRLF record separators", () => {
    expect(() => parseCsv('a,b\r\n"unclosed,b\r\n')).toThrow("ends inside a quoted field");
    expect(() => parseCsv("a,b\na,b\n")).toThrow("Bare LF outside a quoted field");
  });
});
