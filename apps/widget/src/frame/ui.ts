// The chat panel. Plain DOM, no framework. All text goes through text nodes;
// agent replies go through the safe renderer.
import type { Mode } from "../shared/protocol";
import { docentMark, dom, icon } from "./dom";
import { citationLabel, plainExcerpt, renderContent, safeUrl } from "./render";
import type { Citation, ConversationStatus, ConversationSummary, Message, Stage } from "./types";

export const MAX_LENGTH = 2000;
const COUNT_FROM = 1800;

export const STAGE_TEXT: Record<Stage | "loading", string> = {
  loading: "Loading the conversation",
  searching: "Searching the help center",
  writing: "Writing an answer",
  checking: "Checking sources",
};

const STATUS_TEXT: Record<ConversationStatus, string> = {
  open: "Open",
  escalated: "With the team",
  closed: "Closed",
};

/** "Today", "Yesterday", or a short date in the visitor's locale. */
export function when(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

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
  /** Start an empty conversation. The UI has already asked when the current one has messages. */
  onNewChat(): void;
  /** Show the signed-in customer's recent chats. */
  onHistory(): void;
  /** Open one of the recent chats. */
  onPick(conversationId: string): void;
  onExpand(expanded: boolean): void;
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
  /** Questions shown under the greeting while the conversation has no messages. */
  setSuggestions(questions: string[]): void;
  /** Off while history may still fill the conversation, so the suggestions do not flash. */
  allowSuggestions(allowed: boolean): void;
  /** A closed conversation can be read but not continued. */
  setClosed(closed: boolean): void;
  setExpandable(expandable: boolean): void;
  setExpanded(expanded: boolean): void;
  /** Switch to the recent chats view with a progress line. */
  historyLoading(text: string): void;
  setHistory(items: ConversationSummary[], current: string | null): void;
  historyError(text: string): void;
  showChat(): void;
  /** Put host provided text in the message field. Never sends it. */
  prefill(text: string): void;
}

const CLOSE_ICON = "M6 6L18 18M18 6L6 18";
const NEW_ICON = "M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4zM12 7.5v5M9.5 10h5";
const HISTORY_ICON = "M3 12a9 9 0 1 0 2.64-6.36L3 8.3M3 3.5v4.8h4.8M12 7.5V12l3.5 2";
const EXPAND_ICON = "M14 4h6v6M20 4l-6.5 6.5M10 20H4v-6M4 20l6.5-6.5";
const COLLAPSE_ICON = "M13.5 4.5v6h6M20 4l-6.5 6.5M10.5 19.5v-6h-6M4 20l6.5-6.5";
const BACK_ICON = "M19 12H5M11 6l-6 6 6 6";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createUi(
  root: HTMLElement,
  doc: Document,
  handlers: UiHandlers,
  siteUrl: string | null = null,
): Ui {
  const h = dom(doc);
  let agentName = "Support";
  let mode: Mode = "anonymous";
  let busy = false;
  let uid = 0;
  let screen: "chat" | "history" = "chat";
  let blocked = false;
  let closed = false;
  let questions: string[] = [];
  let suggestionsAllowed = true;

  // Header
  const title = h("h1", { class: "name", dir: "auto" });
  const subtitle = h("p", { class: "sub", dir: "auto", hidden: true });
  const tool = (label: string, d: string, attrs: Record<string, string | boolean> = {}): HTMLButtonElement =>
    h("button", { type: "button", class: "icon-btn", "aria-label": label, title: label, ...attrs }, icon(doc, d));
  const recent = tool("Recent chats", HISTORY_ICON, { "aria-pressed": "false", hidden: true });
  const fresh = tool("New chat", NEW_ICON);
  const expand = tool("Expand chat", EXPAND_ICON, { "aria-pressed": "false", hidden: true });
  const close = tool("Close chat", CLOSE_ICON);
  close.addEventListener("click", () => handlers.onClose());
  const header = h(
    "header",
    { class: "hd" },
    h("div", { class: "who" }, title, subtitle),
    h("div", { class: "tools" }, recent, fresh, expand, close),
  );

  // "Start a new chat?" under the header, only when the current chat has messages.
  const confirmText = h("p", { id: "docent-confirm", class: "confirm-text" });
  const confirmYes = h("button", { type: "button", class: "btn" }, "Start new chat");
  const confirmNo = h("button", { type: "button", class: "btn quiet" }, "Cancel");
  const confirm = h(
    "div",
    { class: "confirm", role: "group", "aria-labelledby": "docent-confirm", hidden: true },
    confirmText,
    h("div", { class: "confirm-actions" }, confirmYes, confirmNo),
  );

  // Conversation
  const greeting = h("li", { class: "msg agent greeting" });
  const suggestList = h("ul", { class: "suggest-list", "aria-label": "Suggested questions" });
  const suggest = h("li", { class: "suggest", hidden: true }, suggestList);
  const list = h("ol", { class: "list" }, greeting, suggest);
  const log = h(
    "div",
    { class: "log", role: "log", "aria-live": "polite", "aria-relevant": "additions", "aria-label": "Conversation", tabindex: "0" },
    list,
  );
  const state = h("div", { class: "state", "aria-live": "polite" });
  const status = h("div", { class: "status", role: "status", "aria-live": "polite" });
  const notice = h("p", { class: "notice", "aria-live": "polite" });

  // Recent chats (signed-in customers only)
  const historyTitle = h("h2", { id: "docent-history-title", class: "history-title", tabindex: "-1" }, "Recent chats");
  const back = h("button", { type: "button", class: "back" }, icon(doc, BACK_ICON), "Back to chat");
  const historyStatus = h("p", { class: "history-status", role: "status", "aria-live": "polite" });
  const historyRetry = h("button", { type: "button", class: "btn quiet", hidden: true }, "Try again");
  const historyList = h("ul", { class: "history-list", "aria-labelledby": "docent-history-title" });
  const history = h(
    "section",
    { class: "history", "aria-labelledby": "docent-history-title", hidden: true },
    back,
    historyTitle,
    historyStatus,
    historyRetry,
    historyList,
  );

  // In place of the composer when the conversation is closed.
  const closedNew = h("button", { type: "button", class: "btn" }, "Start a new chat");
  const closedNote = h("div", { class: "closed", hidden: true }, h("p", null, "This chat is closed."), closedNew);

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

  // Quiet attribution under the composer. A new tab, so the chat stays open.
  const mark = docentMark(doc);
  const foot = h(
    "p",
    { class: "foot" },
    siteUrl
      ? h(
          "a",
          { class: "powered", href: siteUrl, target: "_blank", rel: "noopener noreferrer" },
          mark,
          "Powered by Docent",
          h("span", { class: "sr" }, " (opens in a new tab)"),
        )
      : h("span", { class: "powered" }, mark, "Powered by Docent"),
  );

  // One landmark for the whole panel, so every control sits inside it.
  const app = h(
    "main",
    { class: "app" },
    header,
    confirm,
    h("div", { class: "body" }, log, state, history),
    status,
    notice,
    closedNote,
    composer,
    foot,
  );
  root.replaceChildren(app);

  const hasMessages = (): boolean => list.querySelector(".msg:not(.greeting)") !== null;

  /** Which parts show: the chat or the recent chats, and the composer or the closed note. */
  const layout = (): void => {
    const chat = screen === "chat";
    history.hidden = chat;
    log.hidden = !chat || blocked;
    composer.hidden = !chat || blocked || closed;
    closedNote.hidden = !chat || blocked || !closed;
    recent.setAttribute("aria-pressed", String(!chat));
  };

  const refreshSuggestions = (): void => {
    suggest.hidden = !(suggestionsAllowed && questions.length > 0 && !closed && !hasMessages());
  };

  const closeConfirm = (focusBack: boolean): void => {
    if (confirm.hidden) return;
    confirm.hidden = true;
    if (focusBack) fresh.focus();
  };

  const showChat = (): void => {
    if (screen === "chat") return;
    screen = "chat";
    layout();
  };

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

  fresh.addEventListener("click", () => {
    if (busy) return;
    if (!hasMessages() || closed) {
      closeConfirm(false);
      handlers.onNewChat();
      return;
    }
    confirmText.textContent =
      mode === "identified"
        ? "Start a new chat? You can come back to this one from Recent chats."
        : "Start a new chat? You will not be able to come back to this one.";
    confirm.hidden = false;
    confirmYes.focus();
  });
  confirmYes.addEventListener("click", () => {
    closeConfirm(false);
    handlers.onNewChat();
  });
  confirmNo.addEventListener("click", () => closeConfirm(true));
  confirm.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    closeConfirm(true);
  });
  closedNew.addEventListener("click", () => handlers.onNewChat());

  recent.addEventListener("click", () => {
    closeConfirm(false);
    if (screen === "history") {
      showChat();
      recent.focus();
    } else handlers.onHistory();
  });
  back.addEventListener("click", () => {
    showChat();
    recent.focus();
  });
  historyRetry.addEventListener("click", () => handlers.onHistory());
  history.addEventListener("keydown", (e) => {
    // Escape leaves the list first; a second Escape closes the chat.
    if (e.key !== "Escape") return;
    e.preventDefault();
    showChat();
    recent.focus();
  });
  historyList.addEventListener("click", (e) => {
    const item = e.target instanceof Element ? e.target.closest<HTMLElement>("button.history-item") : null;
    if (item?.dataset.id) handlers.onPick(item.dataset.id);
  });

  expand.addEventListener("click", () => handlers.onExpand(expand.getAttribute("aria-pressed") !== "true"));

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

  // Inline [n] chips, source chips, and suggested questions share one delegated handler.
  list.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target.closest("button") : null;
    if (!target) return;
    if (target.classList.contains("suggestion")) {
      // The question becomes the visitor's message; keep focus in the panel.
      if (handlers.onSend(target.textContent ?? "")) input.focus();
    } else if (target.classList.contains("chip")) {
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
        c.excerpt ? h("p", { class: "excerpt", dir: "auto" }, plainExcerpt(c.excerpt)) : null,
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
    // Answered from the visitor's verified account details rather than a help article.
    if (m.role === "agent" && m.citations.length === 0 && (m.decision?.account_facts.length ?? 0) > 0) {
      li.appendChild(h("p", { class: "from-account" }, "From your account"));
    }
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
      recent.hidden = next !== "identified";
      if (next !== "identified") showChat();
    },
    setMessages(messages, contactFor) {
      list.replaceChildren(greeting, suggest, ...messages.map((m) => messageEl(m, contactFor)));
      refreshSuggestions();
      scrollDown();
    },
    addMessage(message, contactFor = null) {
      if (contactFor) dropOpenForms();
      const el = messageEl(message, contactFor);
      list.appendChild(el);
      refreshSuggestions();
      scrollDown();
      return el;
    },
    removeMessage(el) {
      el.remove();
      refreshSuggestions();
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
      fresh.disabled = next;
      recent.disabled = next;
      suggestList.querySelectorAll("button").forEach((b) => (b.disabled = next));
      syncInput();
    },
    setNotice(text) {
      notice.textContent = text ?? "";
    },
    showState(view) {
      state.replaceChildren();
      blocked = view !== null;
      if (blocked) screen = "chat";
      layout();
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
      if (screen === "history") historyTitle.focus();
      else if (!composer.hidden) input.focus();
      else if (!closedNote.hidden) closedNew.focus();
      else (state.querySelector<HTMLElement>("button") ?? close).focus();
    },
    setSuggestions(next) {
      // Sessions renew every half hour; keep the buttons (and any focus) when nothing changed.
      if (next.join("\n") === questions.join("\n")) return;
      questions = next;
      suggestList.replaceChildren(
        ...next.map((q) =>
          h("li", null, h("button", { type: "button", class: "suggestion", dir: "auto", disabled: busy }, q)),
        ),
      );
      refreshSuggestions();
    },
    allowSuggestions(allowed) {
      suggestionsAllowed = allowed;
      refreshSuggestions();
    },
    setClosed(next) {
      closed = next;
      layout();
      refreshSuggestions();
    },
    setExpandable(expandable) {
      expand.hidden = !expandable;
    },
    setExpanded(expanded) {
      expand.setAttribute("aria-pressed", String(expanded));
      expand.replaceChildren(icon(doc, expanded ? COLLAPSE_ICON : EXPAND_ICON));
    },
    historyLoading(text) {
      const entering = screen !== "history";
      screen = "history";
      layout();
      historyStatus.textContent = text;
      historyRetry.hidden = true;
      if (entering) {
        historyList.replaceChildren();
        historyTitle.focus();
      }
    },
    setHistory(items, current) {
      historyStatus.textContent = items.length === 0 ? "No chats yet." : "";
      historyRetry.hidden = true;
      historyList.replaceChildren(
        ...items.map((item) => {
          const meta = [when(item.last_message_at), STATUS_TEXT[item.status], item.id === current ? "Current" : ""];
          return h(
            "li",
            null,
            h(
              "button",
              { type: "button", class: "history-item", "data-id": item.id, "aria-current": item.id === current ? "true" : null },
              h("span", { class: "history-q", dir: "auto" }, item.title),
              h("span", { class: "history-meta" }, meta.filter(Boolean).join(" \u00b7 ")),
            ),
          );
        }),
      );
    },
    historyError(text) {
      historyStatus.textContent = text;
      historyRetry.hidden = false;
    },
    showChat,
    prefill(text) {
      showChat();
      closeConfirm(false);
      input.value = text;
      syncInput();
      if (!composer.hidden) {
        input.focus();
        input.setSelectionRange(text.length, text.length);
      }
    },
  };
}
