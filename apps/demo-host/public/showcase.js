// The Docent snippet as a customer would paste it, plus what identified mode adds.
// Pages without a widget (the Parcelwise sign-in page) get none of it.

const { widget, mode, tokenUrl } = document.body.dataset;

if (widget) {
  // Queue stub: calls made before loader.js arrives are replayed in order.
  window.Docent=window.Docent||{q:[]};["init","open","close","reset"].forEach(function(m){Docent[m]=Docent[m]||function(){Docent.q.push([m,arguments])}});

  if (mode === "identified") {
    Docent.init({
      widget,
      // This site's server signs a short-lived token for the signed-in customer.
      getToken: async () => {
        const response = await fetch(tokenUrl, { credentials: "same-origin" });
        if (!response.ok) throw new Error("Not signed in");
        return response.text();
      },
    });
  }
  // Anonymous mode needs nothing more: data-widget on the script tag starts it.
}

// On sign-out, end the chat session first so the next person on this device starts fresh.
for (const form of document.querySelectorAll("form[data-sign-out]")) {
  form.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      if (window.Docent) await window.Docent.reset();
      form.submit();
    },
    { once: true },
  );
}

for (const button of document.querySelectorAll("[data-open-chat]")) {
  button.addEventListener("click", () => window.Docent?.open());
}

// "Try asking": copy the question, then open the chat. The loader cannot type
// into the chat, and a host page must never reach into the widget's frame.
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const paste = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘V" : "Ctrl+V";

for (const button of document.querySelectorAll("[data-ask]")) {
  button.addEventListener("click", async () => {
    const question = button.getAttribute("data-ask") || "";
    const status = button.closest("section")?.querySelector(".try-status");
    const copied = await copy(question);
    if (status) {
      status.textContent = copied
        ? `Copied. Paste it into the chat with ${paste}, then press Enter.`
        : `Type this into the chat: ${question}`;
    }
    for (const other of document.querySelectorAll("[data-ask][data-picked]")) other.removeAttribute("data-picked");
    button.setAttribute("data-picked", "");
    window.Docent?.open();
  });
}
