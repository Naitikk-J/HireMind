#input_type_name: NotifyReferrerInput
#output_type_name: NotifyReferrerResult
#function_name: notify_referrer

from datetime import datetime, timezone

from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod


class NotifyReferrerInput(BaseModel):
    referrer_id: str
    message_text: str


class NotifyReferrerResult(BaseModel):
    channel: str  # whatsapp | email | preview | skipped
    delivery_ref: str
    referrer_id: str


def _try_whatsapp(pod: Pod, to: str, body: str) -> tuple[bool, str]:
    try:
        wa = pod.connectors.twilio_whatsapp
        res = wa.execute("send_message", {"to": to, "body": body})
        return True, str(res.get("sid", ""))
    except Exception:
        return False, ""


def _try_email(pod: Pod, to: str, body: str) -> tuple[bool, str]:
    try:
        gmail = pod.connectors.gmail
        res = gmail.execute("send_email", {
            "to": [to],
            "subject": "Quick update on the referral",
            "body": body,
        })
        return True, str(res.get("id", ""))
    except Exception:
        return False, ""


async def notify_referrer(ctx: FunctionContext, data: NotifyReferrerInput) -> NotifyReferrerResult:
    pod = Pod.from_env()

    referrer = pod.table("referrers").get(data.referrer_id)
    preferred = referrer.get("preferred_channel", "whatsapp")

    sent_via = "skipped"
    delivery_ref = ""

    if preferred == "whatsapp" and referrer.get("phone"):
        ok, ref = _try_whatsapp(pod, referrer["phone"], data.message_text)
        if ok:
            sent_via, delivery_ref = "whatsapp", ref

    if sent_via == "skipped" and referrer.get("email"):
        ok, ref = _try_email(pod, referrer["email"], data.message_text)
        if ok:
            sent_via, delivery_ref = "email", ref

    if sent_via == "skipped":
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        sent_via, delivery_ref = "preview", f"preview:{ts}"

    if sent_via in ("whatsapp", "email", "preview"):
        pod.table("referrers").update(data.referrer_id, {
            "last_update": datetime.now(timezone.utc).isoformat(),
        })

    return NotifyReferrerResult(
        channel=sent_via,
        delivery_ref=delivery_ref,
        referrer_id=str(data.referrer_id),
    )
