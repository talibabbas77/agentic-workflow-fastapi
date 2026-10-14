// loader.js: runs on the customer's page. Keep it tiny and dependency free.
//
//   <script src="https://WIDGET_ORIGIN/widget/v1/loader.js" data-widget="wid_x" async></script>
//
// data-widget alone starts anonymous mode. Docent.init({ widget, getToken })
// switches to identified mode. Docent.open(), Docent.open({ prefill }),
// Docent.close(), Docent.reset().
import { originOf } from "./checks";
import { createLoader } from "./loader";
import { installApi } from "./queue";

declare global {
  interface Window {
    Docent?: unknown;
  }
}

const VERSION = "1";

function findScript(): HTMLScriptElement | null {
  const current = document.currentScript;
  if (current instanceof HTMLScriptElement) return current;
  // currentScript is null only in unusual embeds; fall back to the tag by path.
  return document.querySelector<HTMLScriptElement>('script[src*="/widget/v1/loader.js"]');
}

const script = findScript();
const origin = originOf(script?.src);
const existing = window.Docent as { v?: unknown } | undefined;

if (existing && existing.v) {
  // Script tag included twice: the first copy already runs the widget.
} else if (origin) {
  const loader = createLoader({ win: window, doc: document, origin });
  if (installApi(window, loader.api, VERSION)) {
    const widget = script?.getAttribute("data-widget");
    if (widget && !loader.hasWidget()) loader.api.init({ widget });
  }
} else {
  console.warn("Docent: could not work out where loader.js was loaded from.");
}
