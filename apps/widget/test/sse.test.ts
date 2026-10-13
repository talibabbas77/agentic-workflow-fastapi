import { describe, expect, it } from "vitest";
import { createSseParser, readSse, type SseEvent } from "../src/frame/sse";

function parseChunks(chunks: string[]): SseEvent[] {
  const events: SseEvent[] = [];
  const parser = createSseParser((e) => events.push(e));
  for (const c of chunks) parser.push(c);
  parser.end();
  return events;
}

const STREAM =
  'event: status\ndata: {"stage":"searching"}\n\n' +
  'event: status\ndata: {"stage":"writing"}\n\n' +
  'event: message\ndata: {"id":"m1","content":"Hi [1]"}\n\n';

describe("SSE parser", () => {
  it("parses several events in one chunk", () => {
    const events = parseChunks([STREAM]);
    expect(events.map((e) => e.event)).toEqual(["status", "status", "message"]);
    expect(JSON.parse(events[2].data)).toEqual({ id: "m1", content: "Hi [1]" });
  });

  it("gives the same result however the stream is split", () => {
    const whole = parseChunks([STREAM]);
    for (let size = 1; size <= 7; size++) {
      const chunks: string[] = [];
      for (let i = 0; i < STREAM.length; i += size) chunks.push(STREAM.slice(i, i + size));
      expect(parseChunks(chunks)).toEqual(whole);
    }
  });

  it("handles a split inside the field name and inside the value", () => {
    const events = parseChunks(["ev", "ent: sta", "tus\nda", 'ta: {"stage":', '"checking"}\n', "\n"]);
    expect(events).toEqual([{ event: "status", data: '{"stage":"checking"}', id: "" }]);
  });

  it("accepts CRLF and lone CR line endings, including CRLF split across chunks", () => {
    expect(parseChunks(["event: a\r\ndata: 1\r", "\n\r\n"])).toEqual([{ event: "a", data: "1", id: "" }]);
    expect(parseChunks(["event: b\rdata: 2\r\r"])).toEqual([{ event: "b", data: "2", id: "" }]);
  });

  it("joins multi-line data, ignores comments, defaults the event name", () => {
    const events = parseChunks([": keep-alive\n", "data: one\ndata: two\n\n"]);
    expect(events).toEqual([{ event: "message", data: "one\ntwo", id: "" }]);
  });

  it("strips only one space after the colon and handles fields without a colon", () => {
    const events = parseChunks(["data:  padded\ndata\n\n"]);
    expect(events[0].data).toBe(" padded\n");
  });

  it("does not dispatch an event that has no data, or one cut off at end of stream", () => {
    expect(parseChunks(["event: status\n\n"])).toEqual([]);
    expect(parseChunks(['event: message\ndata: {"partial":true}\n'])).toEqual([]);
  });

  it("strips a leading byte order mark", () => {
    expect(parseChunks(["﻿data: x\n\n"])).toEqual([{ event: "message", data: "x", id: "" }]);
  });
});

describe("readSse", () => {
  it("decodes UTF-8 split across byte chunks (Arabic text)", async () => {
    const text = 'event: message\ndata: {"content":"مرحبا بك"}\n\n';
    const bytes = new TextEncoder().encode(text);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // One byte at a time splits every multi-byte character.
        for (const b of bytes) controller.enqueue(new Uint8Array([b]));
        controller.close();
      },
    });
    const events: SseEvent[] = [];
    await readSse(stream, (e) => events.push(e));
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].data).content).toBe("مرحبا بك");
  });
});
