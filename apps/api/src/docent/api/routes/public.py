"""Public, unauthenticated, cacheable information."""

from fastapi import APIRouter, Response

from docent.billing.plans import PLANS, Plan

router = APIRouter(prefix="/v1/public", tags=["public"])


@router.get("/plans")
async def list_plans(response: Response) -> list[Plan]:
    response.headers["cache-control"] = "public, max-age=3600"
    return list(PLANS)
