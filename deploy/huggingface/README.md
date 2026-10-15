---
title: Docent
emoji: 💬
colorFrom: red
colorTo: red
sdk: docker
app_port: 7860
pinned: false
short_description: AI support agent that cites its sources and knows the user
---

# Docent

An AI support agent that companies teach from their own help articles. It
answers with citations, knows who a signed-in customer is from a token the
company's server signs, and hands everything else to the team.

This Space runs the whole product in one container. Code:
https://github.com/talibabbas77/agentic-workflow-fastapi

- `/` is the landing page, `/login` the app, `/admin` the operator console.
- `/lumen-notes` is a demo site for anonymous visitors, with the chat widget.
- `/parcelwise` is a demo site for signed-in customers: pick a demo customer.

The companies and customers are fictional. The demo data is loaded again each
time the Space starts.
