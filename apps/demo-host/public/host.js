// The Docent snippet as a customer would paste it, plus the two lines identified mode adds.

// Queue stub: calls made before loader.js arrives are replayed in order.
window.Docent=window.Docent||{q:[]};["init","open","close","reset"].forEach(function(m){Docent[m]=Docent[m]||function(){Docent.q.push([m,arguments])}});

const { widget, signedIn } = document.body.dataset;

if (widget && signedIn === "true") {
  Docent.init({
    widget,
    // Your server signs a short-lived token for the signed-in user.
    getToken: async () => {
      const response = await fetch("/docent-token");
      if (!response.ok) throw new Error("Not signed in");
      return response.text();
    },
  });
}

// On sign-out, end the chat session first so the next person on this device starts fresh.
for (const form of document.querySelectorAll("form[data-sign-out]")) {
  form.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      await Docent.reset();
      form.submit();
    },
    { once: true },
  );
}
