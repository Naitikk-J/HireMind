#input_type_name: RecordScorecardInput
#output_type_name: RecordScorecardResult
#function_name: record_scorecard

from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod


_FINAL_ROUNDS = {"founder_chat", "final_round", "founder"}
_POSITIVE = {"hire", "strong_hire"}


class RecordScorecardInput(BaseModel):
    interview_id: str
    strengths: Optional[str] = None
    concerns: Optional[str] = None
    recommendation: str
    notes: Optional[str] = None


class RecordScorecardResult(BaseModel):
    scorecard_id: str
    candidate_id: str
    advanced_stage: bool


async def record_scorecard(ctx: FunctionContext, data: RecordScorecardInput) -> RecordScorecardResult:
    pod = Pod.from_env()

    if data.recommendation not in {"strong_hire", "hire", "no_hire", "strong_no_hire"}:
        raise ValueError(f"Unknown recommendation: {data.recommendation}")

    interview = pod.table("interviews").get(data.interview_id)
    candidate_id = interview["candidate_id"]

    sc = pod.table("scorecards").create({
        "interview_id": data.interview_id,
        "candidate_id": candidate_id,
        "strengths": data.strengths,
        "concerns": data.concerns,
        "recommendation": data.recommendation,
        "notes": data.notes,
        "submitted_by_user_id": ctx.user_id,
    })

    now = datetime.now(timezone.utc).isoformat()
    pod.table("interviews").update(data.interview_id, {"feedback_sent_at": now})

    advanced_stage = False
    if interview["round"] in _FINAL_ROUNDS and data.recommendation in _POSITIVE:
        candidate = pod.table("candidates").get(candidate_id)
        pod.table("candidates").update(candidate_id, {
            "stage": "offer",
            "next_action": "Extend offer (decision pending)",
        })
        pod.table("tasks").create({
            "type": "decide_offer",
            "owner_user_id": candidate.get("owner_user_id") or ctx.user_id,
            "candidate_id": candidate_id,
            "title": f"Decide on offer for {candidate['name']}",
            "status": "pending",
            "created_by": "record_scorecard",
            "context_ref": {"interview_id": data.interview_id, "recommendation": data.recommendation},
        })
        advanced_stage = True

    return RecordScorecardResult(
        scorecard_id=str(sc["id"]),
        candidate_id=str(candidate_id),
        advanced_stage=advanced_stage,
    )
