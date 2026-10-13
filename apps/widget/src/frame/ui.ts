// The chat panel. Plain DOM, no framework. All text goes through text nodes;
// agent replies go through the safe renderer.
import type { Mode } from "../shared/protocol";
import { dom, icon } from "./dom";
import { citationLabel, renderContent, safeUrl } from "./render";
import type { Citation, Message, Stage } from "./types";

export const MAX_LENGTH = 2000;
const COUNT_FROM = 1800;

export const STAGE_TEXT: Record<Stage | "loading", string> = {
  loading: "Loading the conversation",
  searching: "Searching the help center",
  writing: "Writing an answer",
  checking: "Checking sources",
};

export interface StateView {
  title: string;
  body?: string;
  action?: string;
}

export interface UiHandlers {
  /** Return true if the message was accepted (the input is then cleared). */
  onSend(text: string): boolean;
  onClose(): void;
  onRetry(): void;
  /** Resolves to an error sentence, or null on success. */
  onContact(email: string): Promise<string | null>;
}

export interface Ui {
  setHeader(name: string, subtitle: string | null): void;
  setGreeting(text: string): void;
  setMode(mode: Mode): void;
  setMessages(messages: Message[], contactFor: string | null): void;
  addMessage(message: Message, contactFor?: string | null): HTMLElement;
  removeMessage(el: HTMLElement): void;
  setStatus(stage: Stage | "loading" | null): void;
  setBusy(busy: boolean): void;
  setNotice(text: string | null): void;
  showState(view: StateView | null): void;
  restoreInput(text: string): void;
  clearInput(): void;
  focusInput(): void;
}

const CLOSE_ICON = "M6 6L18 18M18 6L6 18";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createUi(root: HTMLElement, doc: Document, handlers: UiHandlers): Ui {
  const h = dom(doc);
  let agentName = "Support";
  let mode: Mode = "anonymous";
  let busy = false;
  let uid = 0;

  // Header
  const title = h("h1", { class: "name", dir: "auto" });
  const subtitle = h("p", { class: "sub", dir: "auto", hidden: true });
  const close = h("button", { type: "button", class: "icon-btn", "aria-label": "Close chat" }, icon(doc, CLOSE_ICON));
  close.addEventListener("click", () => handlers.onClose());
  const header = h("header", { class: "hd" }, h("div", { class: "who" }, title, subtitle), close);

  // Conversation
  const greeting = h("li", { class: "msg agent greeting" });
  const list = h("ol", { class: "list" }, greeting);
  const log = h(
    "div",
    { class: "log", role: "log", "aria-live": "polite", "aria-relevant": "additions", "aria-label": "Conversation", tabindex: "0" },
    list,
  );
  const state = h("div", { class: "state", "aria-live": "polite" });
  const status = h("div", { class: "status", role: "status", "aria-live": "polite" });
  const notice = h("p", { class: "notice", "aria-live": "polite" });

  // Composer
  const input = h("textarea", {
    class: "input",
    rows: "1",
    maxlength: String(MAX_LENGTH),
    placeholder: "Ask a question",
    dir: "auto",
    "aria-label": "Message",
    "aria-describedby": "docent-count",
    autocomplete: "off",
  });
  const count = h("span", { id: "docent-count", class: "count", "aria-live": "polite" });
  const send = h("button", { type: "submit", class: "send", disabled: true }, "Send");
  const composer = h("form", { class: "composer", novalidate: true }, h("div", { class: "field" }, input, send), count);

  const app = h("div", { class: "app" }, header, h("div", { class: "body" }, log, state), status, notice, composer);
  root.replaceChildren(app);

  const fieldSizing = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content");

  const syncInput = (): void => {
    const len = input.value.length;
    count.textContent = len >= COUNT_FROM ? `${len} / ${MAX_LENGTH} characters` : "";
    send.disabled = busy || input.value.trim() === "";
    if (!fieldSizing) {
      // CSSOM writes are allowed under the frame's style-src 'self' CSP.
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
    }
  };

  const submit = (): void => {
    if (busy) return;
    const text = input.value;
    if (!text.trim()) return;
    if (handlers.onSend(text)) {
      input.value = "";
      syncInput();
    }
  };

  input.addEventListener("input", syncInput);
  input.addEventListener("keydown", (e) => {
    // Enter sends, Shift+Enter adds a line. Never send mid IME composition.
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      submit();
    }
  });
  composer.addEventListener("submit", (e) => {
    e.preventDefault();
    submit();
  });
  doc.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !e.defaultPrevented) handlers.onClose();
  });

  const scrollDown = (): void => {
    log.scrollTop = log.scrollHeight;
  };

  const toggleSource = (chip: HTMLElement, open?: boolean): void => {
    const id = chip.getAttribute("aria-controls");
    const detail = id ? doc.getElementById(id) : null;
    if (!detail) return;
    const next = open ?? chip.getAttribute("aria-expanded") !== "true";
    chip.setAttribute("aria-expanded", String(next));
    detail.hidden = !next;
  };

  // Inline [n] chips and source chips share one delegated handler.
  list.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target.closest("button") : null;
    if (!target) return;
    if (target.classList.contains("chip")) {
      toggleSource(target);
    } else if (target.classList.contains("ref")) {
      const item = target.closest("li.msg");
      const chip = item?.querySelector<HTMLElement>(`.chip[data-marker="${target.dataset.ref}"]`);
      if (chip) {
        toggleSource(chip, true);
        chip.focus();
      }
    }
  });

  const sources = (citations: Citation[]): HTMLElement => {
    const ul = h("ul", { class: "sources", "aria-label": "Sources" });
    const sorted = [...citations].sort((a, b) => a.marker - b.marker);
    for (const c of sorted) {
      const id = `docent-src-${++uid}`;
      const url = safeUrl(c.url);
      const label = citationLabel(c);
      const chip = h(
        "button",
        { type: "button", class: "chip", title: label, "aria-expanded": "false", "aria-controls": id, "data-marker": String(c.marker) },
        h("span", { class: "num" }, String(c.marker)),
        h("span", { class: "label", dir: "auto" }, label),
      );
      const detail = h(
        "div",
        { class: "detail", id, hidden: true },
        c.excerpt ? h("p", { class: "excerpt", dir: "auto" }, c.excerpt) : null,
        url ? h("a", { class: "open", href: url, target: "_blank", rel: "noopener noreferrer" }, "Open page") : null,
      );
      ul.appendChild(h("li", null, chip, detail));
    }
    return ul;
  };

  const contactForm = (): HTMLElement => {
    const id = `docent-email-${++uid}`;
    const field = h("input", {
      id,
      class: "email",
      type: "email",
      inputmode: "email",
      autocomplete: "email",
      maxlength: "254",
      required: true,
      placeholder: "you@example.com",
    });
    const button = h("button", { type: "submit", class: "btn" }, "Send");
    const error = h("p", { class: "field-error", "aria-live": "polite" });
    const form = h(
      "form",
      { class: "contact", novalidate: true },
      h("label", { for: id }, "Where should the team reply?"),
      h("div", { class: "field" }, field, button),
      error,
    );
    let sending = false;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (sending) return;
      const email = field.value.trim();
      if (!EMAIL.test(email) || email.length > 254) {
        error.textContent = "Enter an email address like name@example.com.";
        field.setAttribute("aria-invalid", "true");
        field.focus();
        return;
      }
      sending = true;
      button.disabled = true;
      error.textContent = "";
      field.removeAttribute("aria-invalid");
      const problem = await handlers.onContact(email);
      sending = false;
      button.disabled = false;
      if (problem) {
        error.textContent = problem;
        return;
      }
      const done = h("p", { class: "done", tabindex: "-1" }, `Thanks. The team will reply to ${email}.`);
      form.replaceWith(done);
      done.focus();
    });
    return form;
  };

  const escalation = (withForm: boolean): HTMLElement =>
    h(
      "div",
      { class: "note" },
      h(
        "p",
        null,
        mode === "anonymous" && withForm
          ? "A person from the team will follow up."
          : mode === "identified"
            ? "A person from the team will follow up by email."
            : "This conversation was passed to the team.",
      ),
      withForm ? contactForm() : null,
    );

  const messageEl = (m: Message, contactFor: string | null): HTMLElement => {
    const li = h("li", { class: `msg ${m.role}` });
    if (m.id) li.dataset.id = m.id;
    if (m.role === "system") {
      li.appendChild(h("p", { class: "system-text", dir: "auto" }, m.content));
      return li;
    }
    const who = m.role === "visitor" ? "You" : m.role === "human" ? "Team" : agentName;
    if (m.role === "human") li.appendChild(h("p", { class: "author", "aria-hidden": "true" }, "Team"));
    const bubble = h("div", { class: "bubble", dir: "auto" }, h("span", { class: "sr", dir: "ltr" }, `${who}: `));
    if (m.role === "visitor") bubble.appendChild(h("p", { class: "plain", dir: "auto" }, m.content));
    else bubble.appendChild(renderContent(m.content, m.citations, doc));
    li.appendChild(bubble);
    if (m.role !== "visitor" && m.citations.length > 0) li.appendChild(sources(m.citations));
    if (m.decision?.type === "escalate") li.appendChild(escalation(contactFor !== null && contactFor === m.id));
    return li;
  };

  const dropOpenForms = (): void => {
    list.querySelectorAll("form.contact").forEach((f) => f.remove());
  };

  return {
    setHeader(name, sub) {
      agentName = name;
      title.textContent = name;
      subtitle.textContent = sub ?? "";
      subtitle.hidden = !sub;
    },
    setGreeting(text) {
      greeting.replaceChildren();
      greeting.hidden = !text;
      if (text) {
        greeting.appendChild(
          h("div", { class: "bubble", dir: "auto" }, h("p", { class: "plain", dir: "auto" }, text)),
        );
      }
    },
    setMode(next) {
      mode = next;
    },
    setMessages(messages, contactFor) {
      list.replaceChildren(greeting, ...messages.map((m) => messageEl(m, contactFor)));
      scrollDown();
    },
    addMessage(message, contactFor = null) {
      if (contactFor) dropOpenForms();
      const el = messageEl(message, contactFor);
      list.appendChild(el);
      scrollDown();
      return el;
    },
    removeMessage(el) {
      el.remove();
    },
    setStatus(stage) {
      status.replaceChildren();
      if (stage) {
        status.append(
          h("span", { class: "dots", "aria-hidden": "true" }, h("i"), h("i"), h("i")),
          h("span", null, STAGE_TEXT[stage]),
        );
      }
    },
    setBusy(next) {
      busy = next;
      log.setAttribute("aria-busy", String(next));
      syncInput();
    },
    setNotice(text) {
      notice.textContent = text ?? "";
    },
    showState(view) {
      state.replaceChildren();
      const blocked = view !== null;
      log.hidden = blocked;
      composer.hidden = blocked;
      if (!view) return;
      status.replaceChildren();
      notice.textContent = "";
      state.appendChild(h("p", { class: "state-title" }, view.title));
      if (view.body) state.appendChild(h("p", { class: "state-body" }, view.body));
      if (view.action) {
        const retry = h("button", { type: "button", class: "btn" }, view.action);
        retry.addEventListener("click", () => handlers.onRetry());
        state.appendChild(retry);
      }
    },
    restoreInput(text) {
      if (!input.value) {
        input.value = text;
        syncInput();
      }
    },
    clearInput() {
      input.value = "";
      syncInput();
    },
    focusInput() {
      if (!composer.hidden) input.focus();
      else (state.querySelector<HTMLElement>("button") ?? close).focus();
    },
  };
}
