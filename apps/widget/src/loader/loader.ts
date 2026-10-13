import { RESET_TIMEOUT_MS, SOURCE, isRecord, type InitMessage, type LoaderToFrame, type Mode } from "../shared/protocol";
import { isTrustedReady } from "./checks";
import type { DocentApi, InitOptions } from "./queue";
import { CSS } from "./styles";

export interface LoaderEnv {
  win: Window;
  doc: Document;
  /** Widget origin, taken from the loader script's own URL. */
  origin: string;
  /** Shadow root mode. Always "closed" in production; tests may pass "open". */
  shadowMode?: ShadowRootMode;
}

export interface Loader {
  api: DocentApi;
  /** True once a widget id is known (from data-widget or Docent.init). */
  hasWidget(): boolean;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const MARK = "M14 12H32A18 18 0 0 1 32 48H23L14 57Z";
const RIBBON = "M22 5H30V31L26 26.5L22 31Z";
const CROSS = "M6 6L18 18M18 6L6 18";

export function createLoader(env: LoaderEnv): Loader {
  const { win, doc, origin } = env;
  let widget = "";
  let getToken: InitOptions["getToken"];
  let mode: Mode = "anonymous";
  let isOpen = false;
  let unread = 0;
  let mountQueued = false;
  let host: HTMLElement | undefined;
  let root: ShadowRoot | undefined;
  let button: HTMLButtonElement | undefined;
  let dot: HTMLElement | undefined;
  let frame: HTMLIFrameElement | undefined;
  let port: MessagePort | undefined;
  let resetWaiters: (() => void)[] = [];

  const resetDone = (): void => {
    const waiters = resetWaiters;
    resetWaiters = [];
    waiters.forEach((done) => done());
  };

  const svg = (viewBox: string, cls: string, paths: [string, string][]): SVGSVGElement => {
    const s = doc.createElementNS(SVG_NS, "svg");
    s.setAttribute("viewBox", viewBox);
    s.setAttribute("class", cls);
    s.setAttribute("aria-hidden", "true");
    s.setAttribute("focusable", "false");
    for (const [d, c] of paths) {
      const p = doc.createElementNS(SVG_NS, "path");
      p.setAttribute("d", d);
      if (c) p.setAttribute("class", c);
      s.append(p);
    }
    return s;
  };

  const label = (): void => {
    if (!button || !dot) return;
    button.className = isOpen ? "l o" : "l";
    button.setAttribute("aria-expanded", String(isOpen));
    button.setAttribute(
      "aria-label",
      isOpen
        ? "Close support chat"
        : unread
          ? `Open support chat, ${unread} new ${unread === 1 ? "message" : "messages"}`
          : "Open support chat",
    );
    dot.hidden = isOpen || !unread;
  };

  const setUnread = (count: unknown): void => {
    const n = Math.floor(Number(count));
    unread = n > 0 ? Math.min(n, 99) : 0;
    label();
  };

  // Focus the panel, then tell the frame it is open, on the next frame:
  // WebKit cannot focus an iframe in the same tick it stops being
  // display:none, and a cross-site frame can only move focus to its input
  // once it has focus itself.
  const focusAndOpen = (): void => {
    const go = (): void => {
      if (!frame || !isOpen) return;
      frame.focus();
      send({ type: "open" });
    };
    if (win.requestAnimationFrame && !doc.hidden) win.requestAnimationFrame(go);
    else go();
  };

  const send = (msg: LoaderToFrame, p: MessagePort | undefined = port): void => {
    if (p) p.postMessage(msg);
  };

  // The identity token is fetched on demand, passed straight to the frame,
  // and never stored.
  const token = async (): Promise<string | null> => {
    try {
      const t = getToken ? await getToken() : null;
      return typeof t === "string" && t ? t : null;
    } catch {
      return null;
    }
  };

  const onPort = async (e: MessageEvent): Promise<void> => {
    const d: unknown = e.data;
    const p = e.target as MessagePort;
    if (!isRecord(d) || p !== port) return;
    if (d.type === "token") send({ type: "token", token: await token() }, p);
    else if (d.type === "close") hide(true);
    else if (d.type === "unread") setUnread(isOpen ? 0 : d.count);
    else if (d.type === "reset_done") resetDone();
  };

  const connect = async (f: HTMLIFrameElement): Promise<void> => {
    const channel = new MessageChannel();
    if (port) port.close();
    const p = (port = channel.port1);
    p.onmessage = onPort;
    const t = mode === "identified" ? await token() : null;
    if (f !== frame || p !== port || !f.contentWindow) return;
    // Read the mode again: init() or reset() may have run while getToken was pending.
    const msg: InitMessage = { source: SOURCE, type: "init", mode };
    if (mode === "identified" && t) msg.token = t;
    f.contentWindow.postMessage(msg, origin, [channel.port2]);
    if (isOpen) focusAndOpen();
  };

  const onWindowMessage = (e: MessageEvent): void => {
    if (frame && isTrustedReady(e, origin, frame.contentWindow)) void connect(frame);
  };

  const ensureFrame = (): void => {
    if (frame || !root || !widget) return;
    frame = doc.createElement("iframe");
    frame.className = "f";
    frame.title = "Support chat";
    frame.referrerPolicy = "strict-origin";
    frame.hidden = !isOpen;
    frame.src = `${origin}/widget/v1/frame/${encodeURIComponent(widget)}`;
    root.append(frame);
  };

  const mount = (): boolean => {
    if (host) return true;
    if (!widget || !doc.body) return false;
    host = doc.createElement("docent-widget");
    root = host.attachShadow({ mode: env.shadowMode ?? "closed" });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];
    } catch {
      const style = doc.createElement("style");
      style.textContent = CSS;
      root.append(style);
    }
    button = doc.createElement("button");
    button.type = "button";
    dot = doc.createElement("span");
    dot.className = "d";
    button.append(
      svg("10 1 44 60", "m", [
        [MARK, "b"],
        [RIBBON, "r"],
      ]),
      svg("0 0 24 24", "c", [[CROSS, ""]]),
      dot,
    );
    button.onclick = () => (isOpen ? hide() : show());
    button.onkeydown = (e) => {
      if (e.key === "Escape" && isOpen) hide();
    };
    root.append(button);
    doc.body.append(host);
    label();
    if (isOpen || mode === "identified") ensureFrame();
    return true;
  };

  // Mount after the page has parsed and gone idle, so the host page never waits on us.
  const schedule = (): void => {
    if (host || mountQueued) return;
    mountQueued = true;
    const go = (): void => {
      mountQueued = false;
      mount();
    };
    const idle = (): void => {
      if (win.requestIdleCallback) win.requestIdleCallback(go, { timeout: 2000 });
      else win.setTimeout(go, 1);
    };
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", idle, { once: true });
    else idle();
  };

  const teardown = (): void => {
    resetDone();
    if (port) port.close();
    if (frame) frame.remove();
    port = frame = undefined;
    isOpen = false;
    unread = 0;
    label();
  };

  function show(): void {
    isOpen = true;
    if (!mount()) return schedule();
    ensureFrame();
    if (!frame) return;
    frame.hidden = false;
    setUnread(0);
    focusAndOpen();
  }

  function hide(fromFrame?: boolean): void {
    if (!isOpen) return;
    isOpen = false;
    if (frame) frame.hidden = true;
    label();
    if (!fromFrame) send({ type: "close" });
    if (button && (fromFrame || root?.activeElement === frame)) button.focus();
  }

  win.addEventListener("message", onWindowMessage);

  const api: DocentApi = {
    init(options) {
      const o: InitOptions = isRecord(options) ? options : {};
      const w = typeof o.widget === "string" ? o.widget.trim() : "";
      if (!w) {
        console.warn("Docent: init needs a widget id.");
        return;
      }
      const fn = typeof o.getToken === "function" ? o.getToken : undefined;
      const next: Mode = fn ? "identified" : "anonymous";
      if (widget && w !== widget) teardown();
      const changed = next !== mode;
      widget = w;
      getToken = fn;
      mode = next;
      if (changed) send({ type: "reset", mode });
      if (!host) schedule();
      else if (mode === "identified") ensureFrame();
    },
    open: show,
    close: () => hide(),
    reset() {
      getToken = undefined;
      mode = "anonymous";
      hide();
      setUnread(0);
      const p = port;
      // No connected frame means no session to revoke.
      if (!p) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const timer = win.setTimeout(done, RESET_TIMEOUT_MS);
        function done(): void {
          win.clearTimeout(timer);
          resolve();
        }
        resetWaiters.push(done);
        send({ type: "reset", mode }, p);
      });
    },
  };

  return { api, hasWidget: () => !!widget };
}
