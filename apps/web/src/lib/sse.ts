/**
 * Server-Sent Events from a fetch() body. EventSource cannot POST, so the page
 * reads the stream itself. Follows the WHATWG event stream rules: lines end in
 * \n, \r\n or \r; "field: value" with one optional space after the colon; lines
 * starting with ":" are comments; a blank line dispatches. Same rules as the widget.
 */

export type SseEvent = { event: string; data: string };

function createParser(onEvent: (event: SseEvent) => void) {
  let buffer = "";
  let started = false;
  let event = "";
  let data: string[] = [];

  const dispatch = () => {
    if (data.length > 0) onEvent({ event: event || "message", data: data.join("\n") });
    event = "";
    data = [];
  };

  const line = (text: string) => {
    if (text === "") return dispatch();
    if (text.startsWith(":")) return;
    const colon = text.indexOf(":");
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? "" : text.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  };

  return {
    /** Decoded text. Chunks may split anywhere, even inside "\r\n". */
    push(chunk: string) {
      buffer += chunk;
      if (!started && buffer.length > 0) {
        started = true;
        if (buffer.charCodeAt(0) === 0xfeff) buffer = buffer.slice(1);
      }
      let start = 0;
      for (let i = 0; i < buffer.length; i++) {
        const c = buffer[i];
        if (c !== "\n" && c !== "\r") continue;
        if (c === "\r") {
          // A trailing \r may be the first half of \r\n: wait for the next chunk.
          if (i === buffer.length - 1) break;
          line(buffer.slice(start, i));
          if (buffer[i + 1] === "\n") i++;
        } else {
          line(buffer.slice(start, i));
        }
        start = i + 1;
      }
      buffer = buffer.slice(start);
    },
    /** An event without its final blank line is dropped, as the spec says. */
    end() {
      if (buffer.endsWith("\r")) line(buffer.slice(0, -1));
      buffer = "";
      event = "";
      data = [];
    },
  };
}

/** Read a byte stream to the end, decoding UTF-8 across chunk boundaries. */
export async function readSse(body: ReadableStream<Uint8Array>, onEvent: (event: SseEvent) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  const parser = createParser(onEvent);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.end();
  } finally {
    reader.releaseLock();
  }
}
