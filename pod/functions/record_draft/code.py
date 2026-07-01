#input_type_name: RecordDraftInput
#output_type_name: RecordDraftResult
#function_name: record_draft

from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class RecordDraftInput(BaseModel):
    candidate_id: str
    subject: str
    body: str
    channel: str = Field(default="email", description="email | linkedin")
    voice_check: Optional[str] = None
    intent: str = Field(
        default="intro",
        description="intro | screening_request | offer_letter — drives stage routing on send.",
    )


class RecordDraftResult(BaseModel):
    message_id: str
    candidate_id: str
    subject: str
    body: str
    channel: str
    intent: str


async def record_draft(ctx: FunctionContext, data: RecordDraftInput) -> RecordDraftResult:
    pod = Pod.from_env()

    # Fail loud if the candidate isn't real — we don't want to write
    # orphaned drafts that the operator can never act on.
    candidate = pod.table("candidates").get(data.candidate_id)
    if not candidate:
        raise ValueError(f"Candidate {data.candidate_id} not found — refusing to persist draft.")

    row = pod.table("messages").create({
        "candidate_id": data.candidate_id,
        "direction": "outbound",
        "channel": data.channel,
        "subject": data.subject,
        "body": data.body,
        "status": "awaiting_approval",
        "created_by": "outreach_drafter",
        "intent": (data.intent or "intro").strip().lower() or "intro",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    return RecordDraftResult(
        message_id=str(row["id"]),
        candidate_id=str(data.candidate_id),
        subject=data.subject,
        body=data.body,
        channel=data.channel,
        intent=(data.intent or "intro"),
    )
