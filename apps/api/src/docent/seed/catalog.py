"""Who and what the demo contains. Every company, person, and customer is fictional.

Four workspaces cover every plan state the app can be in, and the owner account
from the command line has a different role in each, so one login shows the
owner, admin, and agent views:

  Lumen Notes     Growth, active             owner
  Parcelwise      Scale, active              admin
  Tallyfox        Starter, payment failed     agent
  Fernway Studio  Trial, 9 days left          owner (a fresh, empty workspace)

Teammates use public @mailinator.com inboxes and share one easy password.
Customers (people chatting in the widget) never log in to Docent.
"""

from dataclasses import dataclass, field

DEMO_PASSWORD = "Docent@123"  # noqa: S105 - shared by local demo accounts only
DEMO_DOMAIN = "mailinator.com"
DEMO_HOST_ORIGIN = "http://localhost:5173"  # apps/demo-host plays the customer's website
OWNER = "owner"  # the account given on the command line


def demo_email(local: str) -> str:
    return f"docent-{local}@{DEMO_DOMAIN}"


@dataclass(frozen=True)
class Person:
    name: str
    email: str


@dataclass(frozen=True)
class TicketType:
    name: str
    description: str
    fields: tuple[dict[str, object], ...]
    priority: str = "normal"


@dataclass(frozen=True)
class Customer:
    """Someone signed in to the company's own product, chatting in its widget."""

    external_id: str
    name: str
    email: str
    claims: dict[str, str]


@dataclass(frozen=True)
class Scenario:
    turns: tuple[str, ...]
    customer: str | None = None  # a key of Workspace.customers; None is an anonymous visitor


@dataclass(frozen=True)
class Plan:
    plan_id: str
    status: str  # trialing, active, past_due
    days_left: int  # until the trial ends or the period renews
    past_due_days: int = 0


@dataclass(frozen=True)
class Workspace:
    name: str
    slug: str
    plan: Plan
    members: tuple[tuple[str, str], ...]  # (person key, role)
    invites: tuple[tuple[str, str], ...]  # (email, role)
    docs: str | None = None  # folder under fixtures/
    greeting: str = ""
    claims: tuple[str, ...] = ()
    tone: str = "friendly"
    restricted_topics: tuple[str, ...] = ()
    ticket_types: tuple[TicketType, ...] = ()
    team_answers: tuple[tuple[str, str], ...] = ()
    customers: dict[str, Customer] = field(default_factory=dict)
    scenarios: tuple[Scenario, ...] = ()
    replies_this_month: int = 0  # shown on the billing page; generated replies count too
    replies_history: tuple[int, ...] = ()  # the three months before this one, oldest first


TEAM: dict[str, Person] = {
    "maya": Person("Maya Chen", demo_email("maya.chen")),
    "omar": Person("Omar Haddad", demo_email("omar.haddad")),
    "priya": Person("Priya Nair", demo_email("priya.nair")),
    "lucas": Person("Lucas Martin", demo_email("lucas.martin")),
    "sofia": Person("Sofia Rossi", demo_email("sofia.rossi")),
    "kenji": Person("Kenji Watanabe", demo_email("kenji.watanabe")),
    "nina": Person("Nina Okafor", demo_email("nina.okafor")),
    "daniel": Person("Daniel Weber", demo_email("daniel.weber")),
}


def _customer(external_id: str, name: str, **claims: str) -> Customer:
    local = name.lower().replace(" ", ".")
    return Customer(external_id, name, demo_email(local), claims)


LUMEN = Workspace(
    name="Lumen Notes",
    slug="lumen-notes",
    plan=Plan("growth", "active", days_left=18),
    members=((OWNER, "owner"), ("maya", "admin"), ("omar", "agent"), ("priya", "agent")),
    invites=((demo_email("jordan.lee"), "agent"), (demo_email("ava.brooks"), "admin")),
    docs="golden/lumen-notes",
    greeting="Hi, I can help with anything about Lumen Notes.",
    claims=("plan", "workspace"),
    restricted_topics=("refund dispute", "data deletion request"),
    ticket_types=(
        TicketType(
            "Billing question",
            "Charges, invoices, refunds, plan changes, and payment methods.",
            (
                {"key": "invoice_number", "label": "Invoice number"},
                {
                    "key": "plan",
                    "label": "Plan",
                    "type": "select",
                    "options": ["Free", "Plus", "Team", "Enterprise"],
                },
            ),
        ),
        TicketType(
            "Bug report",
            "Something in the app is broken, crashes, or does not sync.",
            (
                {
                    "key": "device",
                    "label": "Device",
                    "type": "select",
                    "options": ["Mac", "Windows", "iPhone", "Android", "Web"],
                },
                {"key": "app_version", "label": "App version"},
            ),
            priority="high",
        ),
        TicketType(
            "Account access",
            "Cannot sign in, lost two-step login, or locked out.",
            ({"key": "account_email", "label": "Account email", "type": "email"},),
            priority="high",
        ),
    ),
    team_answers=(
        (
            "Does Lumen have a dark mode?",
            "Not yet. Dark mode for the desktop and web apps is planned for later this year. "
            "Until then, Lumen follows your system's light setting.",
        ),
        (
            "Can I use my own custom domain for notes I publish to the web?",
            "Not at the moment. Published notes use a lumen-notes.example link. Custom domains "
            "are planned for the Team plan.",
        ),
    ),
    customers={
        "ana": _customer("lumen-1042", "Ana Souza", plan="Team", workspace="Souza Design Studio"),
        "ben": _customer("lumen-2210", "Ben Carter", plan="Free", workspace="Ben's notes"),
        "carla": _customer("lumen-3318", "Carla Mendes", plan="Plus", workspace="Carla writes"),
        "david": _customer("lumen-4127", "David Kim", plan="Team", workspace="Kim and Partners"),
    },
    scenarios=(
        Scenario(
            (
                "I never clicked the verification link in the welcome email and now it says "
                "it expired. What do I do?",
            )
        ),
        Scenario(
            (
                "What plan am I on?",
                "On my plan, how far back can I roll a note back to an older version?",
            ),
            customer="ana",
        ),
        Scenario(
            ("Hi!", "Can I get my money back if I cancel an annual Plus plan after two weeks?")
        ),
        Scenario(("free plan how many devices", "ok thanks!"), customer="ben"),
        Scenario(("Do you offer a phone app for smart watches?",)),
        Scenario(("Does Lumen have a dark mode?",)),
        Scenario(
            ("I need our VAT number added to an invoice you sent last month",), customer="david"
        ),
        Scenario(
            (
                "I want to talk to a person about a chargeback",
                "you can reach me at jo.alvarez@mailinator.com",
            )
        ),
        Scenario(("2fa lost phone", "I don't have my backup codes either"), customer="carla"),
        Scenario(("it doesn't work", "the desktop app stopped syncing my notes")),
        Scenario(("What's the capital of France?",)),
        Scenario(("Can we pay by bank transfer instead of a card?",), customer="ana"),
        Scenario(("accidentally deleted a note last week, can I still get it back?",)),
        Scenario(("Can I dictate notes by voice and have them transcribed?",)),
        Scenario(("talk to a human please",), customer="ben"),
        Scenario(("Is there a one-time lifetime license instead of a subscription?",)),
        Scenario(("Can I use my own custom domain for notes I publish to the web?",)),
        Scenario(
            (
                "Who are you?",
                "Can outside collaborators we invite to one notebook count as paid seats?",
            ),
            customer="david",
        ),
    ),
    replies_this_month=1840,
    replies_history=(2210, 2785, 3150),
)

PARCELWISE = Workspace(
    name="Parcelwise",
    slug="parcelwise",
    plan=Plan("scale", "active", days_left=9),
    members=(("lucas", "owner"), (OWNER, "admin"), ("sofia", "agent"), ("kenji", "agent")),
    invites=((demo_email("noah.patel"), "agent"),),
    docs="golden/parcelwise",
    greeting="Hi, ask me about shipping, labels, or the Parcelwise API.",
    claims=("plan", "account"),
    tone="neutral",
    ticket_types=(
        TicketType(
            "Shipment problem",
            "A parcel is late, lost, damaged, or stuck in tracking.",
            (
                {"key": "tracking_number", "label": "Tracking number", "required": True},
                {
                    "key": "carrier",
                    "label": "Carrier",
                    "type": "select",
                    "options": ["Larkspur Express", "Bluecrest", "Postline", "Other"],
                },
            ),
            priority="high",
        ),
        TicketType(
            "API integration",
            "Errors, rate limits, webhooks, or keys in an integration with the API.",
            (
                {"key": "endpoint", "label": "Endpoint"},
                {"key": "request_id", "label": "Request id"},
            ),
        ),
        TicketType(
            "Billing and invoices",
            "Charges, label fees, carrier adjustments, and invoices.",
            ({"key": "invoice_number", "label": "Invoice number"},),
        ),
    ),
    team_answers=(
        (
            "Is there a mobile app for printing labels from my phone?",
            "There is no separate app. The dashboard works in any phone browser, and labels "
            "download as PDF, or as ZPL for thermal printers.",
        ),
    ),
    customers={
        "chloe": _customer("pw-31877", "Chloe Dubois", plan="Scale", account="Maison Dubois"),
        "diego": _customer("pw-40512", "Diego Ramos", plan="Starter", account="Ramos Outdoor"),
        "emma": _customer("pw-52290", "Emma Wright", plan="Growth", account="Wright Supplies"),
    },
    scenarios=(
        Scenario(("What's the per-label fee on my plan?",), customer="chloe"),
        Scenario(("how do I switch to a new API key without any downtime",)),
        Scenario(
            ("I bought a label by mistake. How do I cancel it so I get the postage back?",),
            customer="diego",
        ),
        Scenario(
            ("Our nightly job keeps getting 429s. What's the right way to back off and retry?",)
        ),
        Scenario(("Can I ship hazardous materials like lithium batteries?",)),
        Scenario(
            ("Tracking says the parcel is waiting in a locker. Which status is that?",),
            customer="emma",
        ),
        Scenario(("Is there a mobile app for printing labels from my phone?",)),
        Scenario(
            (
                "The carrier charged us extra weeks later saying the box weighed more than "
                "we said. Can we fight that?",
            ),
            customer="chloe",
        ),
        Scenario(("I want to speak to someone about my invoice",), customer="diego"),
        Scenario(("Do you support cash on delivery?",)),
        Scenario(("Hello", "How long do I have to void a Larkspur Express label?")),
        Scenario(("Can we give customers 60 days to send things back instead of 30?",)),
        Scenario(("How do I check that a webhook request really came from you?",), customer="emma"),
        Scenario(("Do you have a GraphQL API?",)),
    ),
    replies_this_month=6020,
    replies_history=(9400, 11200, 12850),
)

TALLYFOX = Workspace(
    name="Tallyfox",
    slug="tallyfox",
    plan=Plan("starter", "past_due", days_left=12, past_due_days=3),
    members=(("nina", "owner"), ("daniel", "admin"), (OWNER, "agent")),
    invites=(),
    docs="demo/tallyfox",
    greeting="Hi! Ask me about invoices, payments, or your Tallyfox plan.",
    claims=("plan",),
    ticket_types=(
        TicketType(
            "Invoice question",
            "Creating, sending, numbering, or correcting invoices.",
            ({"key": "invoice_number", "label": "Invoice number"},),
        ),
        TicketType(
            "Payment problem",
            "A client payment failed, is pending, or was refunded.",
            (
                {"key": "client_name", "label": "Client name"},
                {"key": "amount", "label": "Amount"},
            ),
            priority="high",
        ),
    ),
    team_answers=(
        (
            "Can clients pay an invoice in installments?",
            "Yes. Record each payment with Record payment on the invoice. The invoice shows as "
            "partly paid and reminders continue until the balance is zero.",
        ),
    ),
    customers={
        "frank": _customer("tf-1201", "Frank Osei", plan="Solo"),
        "grace": _customer("tf-1388", "Grace Lin", plan="Studio"),
    },
    scenarios=(
        Scenario(("How do I add my bank details to invoices?",)),
        Scenario(("My client did not receive the invoice email",), customer="frank"),
        Scenario(("Can I bill a client in euros?",)),
        Scenario(("Can clients pay an invoice in installments?",), customer="grace"),
        Scenario(("Do you integrate with QuickBooks?",)),
        Scenario(("I'd like a refund for my subscription, I paid 10 days ago",), customer="frank"),
        Scenario(("Can I talk to someone about a lawsuit?",)),
    ),
    replies_this_month=820,
    replies_history=(610, 745, 812),
)

FERNWAY = Workspace(
    name="Fernway Studio",
    slug="fernway-studio",
    plan=Plan("trial", "trialing", days_left=9),
    members=((OWNER, "owner"),),
    invites=((demo_email("sam.rivera"), "admin"),),
)

WORKSPACES: tuple[Workspace, ...] = (LUMEN, PARCELWISE, TALLYFOX, FERNWAY)
