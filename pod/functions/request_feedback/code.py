#input_type_name: RequestFeedbackInput
#output_type_name: RequestFeedbackResult
#function_name: request_feedback

from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod


class RequestFeedbackInput(BaseModel):
    interview_id: str
    form_url: Optional[str] = None


class RequestFeedbackResult(BaseModel):
    interview_id: str
    interviewer: str
    task_id: str
    slack_ref: str


async def request_feedback(ctx: FunctionContext, data: RequestFeedbackInput) -> RequestFeedbackResult:
    pod = Pod.from_env()

    interview = pod.table("interviews").get(data.interview_id)
    candidate = pod.table("candidates").get(interview["candidate_id"])

    interviewer_user_id = interview.get("interviewer_user_id")
    interviewer_email = interview.get("interviewer_email")
    interviewer = interviewer_email or str(interviewer_user_id) or "interviewer"

    form_url = data.form_url or f"hiremind://forms/scorecard/{data.interview_id}"

    body = (
        f"Hey — *{candidate['name']}* just finished their *{interview['round']}* round. "
        f"Quick scorecard (90 sec): {form_url}"
    )

    slack_ref = ""
    if interviewer_user_id or interviewer_email:
        try:
            slack = pod.connectors.slack
            target = {"user_id": str(interviewer_user_id)} if interviewer_user_id else {"email": interviewer_email}
            res = slack.execute("send_dm", {**target, "text": body})
            slack_ref = str(res.get("ts", ""))
        except Exception:
            slack_ref = ""

    task = pod.table("tasks").create({
        "type": "submit_feedback",
        "owner_user_id": interviewer_user_id,
        "candidate_id": candidate["id"],
        "title": f"Scorecard for {candidate['name']} — {interview['round']}",
        "status": "pending",
        "created_by": "request_feedback",
        "context_ref": {"interview_id": data.interview_id, "slack_ref": slack_ref},
    })

    pod.table("interviews").update(data.interview_id, {
        "feedback_sent_at": datetime.now(timezone.utc).isoformat(),
    })

    return RequestFeedbackResult(
        interview_id=str(data.interview_id),
        interviewer=interviewer,
        task_id=str(task["id"]),
        slack_ref=slack_ref,
    )
