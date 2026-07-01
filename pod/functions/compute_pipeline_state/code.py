#input_type_name: ComputePipelineStateInput
#output_type_name: PipelineState
#function_name: compute_pipeline_state

from datetime import datetime, timedelta, timezone
from typing import Any, List, Optional

from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod


def _items(response: Any) -> list[dict[str, Any]]:
    """Normalize SDK list responses (Pydantic models, dicts, raw) into a plain list of row dicts."""
    if hasattr(response, "to_dict"):
        return response.to_dict().get("items") or []
    if isinstance(response, dict):
        return response.get("items") or []
    return list(getattr(response, "items", []) or [])


class ComputePipelineStateInput(BaseModel):
    pass


class StaleCandidate(BaseModel):
    name: str
    days_since_contact: int
    stage: str


class PendingDecision(BaseModel):
    candidate_name: str
    kind: str
    detail: str


class NewArrival(BaseModel):
    name: str
    source: str
    role_title: Optional[str] = None


class ReferrerDue(BaseModel):
    referrer_name: str
    candidate_name: str
    days_since_update: int


class PipelineState(BaseModel):
    snapshot_at: str
    stale_replies: List[StaleCandidate]
    decisions_pending: List[PendingDecision]
    new_arrivals: List[NewArrival]
    referrer_updates_due: List[ReferrerDue]
    active_count: int
    offer_count: int


def _days_between(then_iso: Optional[str], now: datetime) -> int:
    if not then_iso:
        return 999
    then = datetime.fromisoformat(then_iso.replace("Z", "+00:00"))
    return max(0, (now - then).days)


async def compute_pipeline_state(ctx: FunctionContext, data: ComputePipelineStateInput) -> PipelineState:
    pod = Pod.from_env()
    now = datetime.now(timezone.utc)
    week_ago = (now - timedelta(days=7)).isoformat()

    candidates = _items(pod.records.list(
        "candidates",
        limit=500,
        filter=[{"field": "status", "op": "eq", "value": "active"}],
    ))
    roles = {r["id"]: r["title"] for r in _items(pod.records.list("roles", limit=100))}

    stale: List[StaleCandidate] = []
    for c in candidates:
        if c["stage"] in ("intro_sent", "replied") and c.get("last_contact"):
            days = _days_between(c["last_contact"], now)
            if days >= 4:
                stale.append(StaleCandidate(name=c["name"], days_since_contact=days, stage=c["stage"]))
    stale.sort(key=lambda s: -s.days_since_contact)

    pending_tasks = _items(pod.records.list(
        "tasks",
        limit=50,
        filter=[
            {"field": "status", "op": "eq", "value": "pending"},
            {"field": "type", "op": "eq", "value": "decide_offer"},
        ],
    ))
    decisions: List[PendingDecision] = []
    for t in pending_tasks:
        if not t.get("candidate_id"):
            continue
        cand = pod.table("candidates").get(t["candidate_id"])
        decisions.append(PendingDecision(
            candidate_name=cand["name"],
            kind="offer",
            detail=t.get("title") or "Decide on offer",
        ))

    new_arrivals: List[NewArrival] = []
    for c in candidates:
        if c.get("created_at") and c["created_at"] >= week_ago and c["stage"] == "sourced":
            new_arrivals.append(NewArrival(
                name=c["name"], source=c["source"],
                role_title=roles.get(c.get("role_id")),
            ))

    referrers = _items(pod.records.list("referrers", limit=200))
    referrer_due: List[ReferrerDue] = []
    for r in referrers:
        if not r.get("last_update"):
            continue
        days = _days_between(r["last_update"], now)
        if days >= 5:
            ref_cands = [c for c in candidates if c.get("referrer_id") == r["id"] and c["stage"] not in ("hired", "closed")]
            for c in ref_cands[:1]:
                referrer_due.append(ReferrerDue(
                    referrer_name=r["name"], candidate_name=c["name"], days_since_update=days,
                ))

    offers = sum(1 for c in candidates if c["stage"] == "offer")

    return PipelineState(
        snapshot_at=now.isoformat(),
        stale_replies=stale[:10],
        decisions_pending=decisions[:10],
        new_arrivals=new_arrivals[:10],
        referrer_updates_due=referrer_due[:10],
        active_count=len(candidates),
        offer_count=offers,
    )
