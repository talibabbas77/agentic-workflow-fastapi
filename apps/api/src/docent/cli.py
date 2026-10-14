"""Command line entry point: `docent api | worker | db migrate | openapi`."""

import argparse
import json
import sys
from pathlib import Path

import uvicorn

from docent.config import get_settings, repo_root

API_ROOT = Path(__file__).resolve().parents[2]
FIXTURES = (repo_root() or API_ROOT) / "fixtures" / "golden"
SAFETY = (repo_root() or API_ROOT) / "fixtures" / "agent"
BASELINE = FIXTURES / "baseline.json"
DEMO_KEYS = (repo_root() or API_ROOT) / ".data" / "demo-host"
SEED_FIXTURES = (repo_root() or API_ROOT) / "fixtures"


def _alembic_config() -> object:
    from alembic.config import Config

    return Config(str(API_ROOT / "alembic.ini"))


def _serve(target: str, host: str, port: int, reload: bool) -> None:
    settings = get_settings()
    uvicorn.run(
        target,
        factory=True,
        host=host,
        port=port,
        reload=reload,
        reload_dirs=[str(API_ROOT / "src")] if reload else None,
        proxy_headers=True,
        forwarded_allow_ips=settings.forwarded_allow_ips,
        server_header=False,
        log_config=None,
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="docent")
    sub = parser.add_subparsers(dest="command", required=True)

    for name, port in (("api", 8000), ("worker", 8001)):
        p = sub.add_parser(name)
        p.add_argument("--host", default="127.0.0.1")
        p.add_argument("--port", type=int, default=port)
        p.add_argument("--reload", action="store_true")

    db = sub.add_parser("db")
    db_sub = db.add_subparsers(dest="db_command", required=True)
    db_sub.add_parser("migrate")
    db_sub.add_parser("current")
    down = db_sub.add_parser("downgrade")
    down.add_argument("revision")

    sub.add_parser("openapi")

    billing = sub.add_parser("billing", help="Payments")
    billing_sub = billing.add_subparsers(dest="billing_command", required=True)
    billing_sub.add_parser(
        "sync-stripe", help="Create the Stripe products and monthly prices for every paid plan"
    )

    seed = sub.add_parser("seed", help="Load demo data (local and test only)")
    seed.add_argument("--owner-email", required=True)
    seed.add_argument("--owner-name", default="Talib Abbas")
    seed.add_argument("--reset", action="store_true", help="Rebuild the demo data from scratch")
    seed.add_argument("--api-url", default="http://127.0.0.1:8000", help="Used to upload docs")
    seed.add_argument("--fixtures", type=Path, default=SEED_FIXTURES)
    seed.add_argument(
        "--no-conversations",
        action="store_true",
        help="Skip the customer conversations (they need the worker and the chat model)",
    )
    seed.add_argument(
        "--demo-keys", type=Path, default=DEMO_KEYS, help="Where the demo host's signing keys go"
    )

    evaluate = sub.add_parser("eval", help="Quality checks")
    eval_sub = evaluate.add_subparsers(dest="eval_command", required=True)
    retrieval = eval_sub.add_parser("retrieval", help="Recall and threshold on fixtures/golden")
    retrieval.add_argument("--fixtures", type=Path, default=FIXTURES)
    retrieval.add_argument("--out", type=Path, help="Write the full JSON report here")
    retrieval.add_argument("--min-recall", type=float, default=0.85)
    agent_eval = eval_sub.add_parser(
        "agent", help="Answers, handoffs, and safety with the real model"
    )
    agent_eval.add_argument("--fixtures", type=Path, default=FIXTURES)
    agent_eval.add_argument("--safety", type=Path, default=SAFETY)
    agent_eval.add_argument("--sample", type=int, help="Questions per company (default all)")
    agent_eval.add_argument("--out", type=Path, help="Write the full JSON report here")
    gate = eval_sub.add_parser(
        "gate", help="Compare a run with the stored baseline; exit 1 if it got worse"
    )
    gate.add_argument(
        "--report",
        type=Path,
        required=True,
        help="JSON from `docent eval agent --out`, or a run from GET /v1/evals/runs/{id}",
    )
    gate.add_argument("--baseline", type=Path, default=BASELINE)
    gate.add_argument(
        "--max-wrong-increase",
        type=float,
        default=0.02,
        help="How far the wrong-answer rate may rise, as a fraction (default 0.02, 2 points)",
    )
    gate.add_argument(
        "--max-recall-drop",
        type=float,
        default=0.0,
        help="How far escalation recall may fall from the baseline (default 0)",
    )
    gate.add_argument(
        "--min-recall", type=float, default=0.95, help="Escalation recall floor (default 0.95)"
    )
    gate.add_argument(
        "--write-baseline",
        action="store_true",
        help="Store this report's metrics as the new baseline instead of checking it",
    )

    args = parser.parse_args(argv)

    if args.command == "api":
        _serve("docent.api.app:create_app", args.host, args.port, args.reload)
    elif args.command == "worker":
        _serve("docent.worker_app:create_worker_app", args.host, args.port, args.reload)
    elif args.command == "db":
        from alembic import command

        cfg = _alembic_config()
        if args.db_command == "migrate":
            command.upgrade(cfg, "head")  # type: ignore[arg-type]
        elif args.db_command == "current":
            command.current(cfg)  # type: ignore[arg-type]
        else:
            command.downgrade(cfg, args.revision)  # type: ignore[arg-type]
    elif args.command == "seed":
        import asyncio

        from docent.seed import seed as run_seed

        for line in asyncio.run(
            run_seed(
                get_settings(),
                args.owner_email,
                args.owner_name,
                reset=args.reset,
                api_url=args.api_url,
                fixtures=args.fixtures,
                demo_keys=args.demo_keys,
                with_conversations=not args.no_conversations,
                say=lambda line: print(line, flush=True),
            )
        ):
            print(line)
    elif args.command == "eval" and args.eval_command == "gate":
        _gate(args)
    elif args.command == "eval":
        import asyncio

        from docent.evals.corpus import load_corpus

        corpus = load_corpus(args.fixtures)
        if args.eval_command == "retrieval":
            from docent.evals.retrieval import run as run_retrieval

            report = asyncio.run(run_retrieval(get_settings(), corpus))
        else:
            from docent.evals.agent import load_safety
            from docent.evals.agent import run as run_agent

            report = asyncio.run(
                run_agent(get_settings(), corpus, load_safety(args.safety), args.sample)
            )
        print(json.dumps({k: v for k, v in report.items() if not isinstance(v, list)}, indent=2))
        if args.out:
            args.out.write_text(json.dumps(report, indent=2, default=str) + "\n")
        if args.eval_command == "retrieval":
            for company in report["companies"]:
                print(f"{company['name']}: recall@8 {company['section_recall_at_8']}")
            if report["section_recall_at_8"] < args.min_recall:
                raise SystemExit(
                    f"section recall {report['section_recall_at_8']} < {args.min_recall}"
                )
    elif args.command == "billing":
        import asyncio

        from docent.billing.gateway import stripe_gateway

        gateway = stripe_gateway(get_settings())
        if gateway is None:
            raise SystemExit("Set STRIPE_SECRET_KEY first (a test key starts with sk_test_).")
        for line in asyncio.run(gateway.sync_catalog()):
            print(line)
    elif args.command == "openapi":
        from docent.api.app import create_app

        json.dump(create_app().openapi(), sys.stdout, indent=2)
        sys.stdout.write("\n")


def _gate(args: argparse.Namespace) -> None:
    from docent.evals import gate

    report = gate.load(args.report)
    if args.write_baseline:
        metrics = gate.metrics_of(report)
        kept = {
            k: metrics.get(k)
            for k in ("model", "wrong_answer_rate", "escalation_recall", "safety_pass_rate")
            if metrics.get(k) is not None
        }
        args.baseline.write_text(json.dumps(kept, indent=2) + "\n")
        print(f"Baseline written to {args.baseline}")
        return
    result = gate.check(
        report,
        gate.load(args.baseline),
        gate.Limits(
            max_wrong_increase=args.max_wrong_increase,
            max_recall_drop=args.max_recall_drop,
            min_recall=args.min_recall,
        ),
    )
    print(gate.render(result))
    if not result.passed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
