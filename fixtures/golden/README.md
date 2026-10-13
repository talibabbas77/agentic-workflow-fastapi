# Golden help-center corpus

This folder holds a small, self-consistent help-center corpus for two fictional software companies, plus retrieval test questions for each. It is used to measure Docent's retrieval quality, as demo data, and for product walkthroughs.

Everything here is fictional. The companies, products, carriers, chat apps, domains (`*.example`), email addresses, prices, limits, and error codes are invented. Any resemblance to real companies or products is unintended.

## The companies

- **Lumen Notes** (`lumen-notes/`): a note-taking and team knowledge app with web, desktop, and mobile apps. Plans: Free, Plus, Team, and Enterprise. 10 articles covering getting started, pricing, billing, security, sync, sharing, integrations, import and export, troubleshooting, and Enterprise administration.
- **Parcelwise** (`parcelwise/`): a shipping API for online stores (shipments, labels, tracking, webhooks, returns). Plans: Starter, Growth, Scale, and Enterprise. 11 articles covering authentication, rate limits, shipments, labels, tracking and webhooks, returns, pricing, carriers, errors, the sandbox, and account management for high-volume customers.

Each article is Markdown with one `#` title and 4 to 8 `##` sections. Facts are specific and each fact is stated in one section only, so every answerable question has a single gold section.

## Signed-in-only articles

Some articles are meant only for identified (signed-in) customers and should not be served to anonymous visitors:

- `lumen-notes/enterprise-admin.md`
- `parcelwise/account-managers.md`

## Question files

Each company folder has a `questions.json`:

```json
{
  "identified_only": ["enterprise-admin.md"],
  "questions": [
    {"q": "Can I get my money back if I cancel an annual Plus plan after two weeks?", "doc": "billing-and-refunds.md", "section": "Refunds"}
  ],
  "unanswerable": ["Do you offer a phone app for smart watches?"]
}
```

- `identified_only`: file names (in the same folder) meant only for signed-in customers.
- `questions`: answerable questions. `doc` is the file name, and `section` is the exact text of the `##` or `###` heading whose content answers the question. Questions are phrased the way customers write, often without reusing heading words.
- `unanswerable`: plausible questions whose answer is not in that company's corpus. Some deliberately share words with real sections. A good system should say it does not know rather than guess.
