#input_type_name: SendDigestInput
#output_type_name: SendDigestResult
#function_name: send_digest

import os
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod


class SendDigestInput(BaseModel):
    message_text: str
    founder_phone: Optional[str] = None
    founder_email: Optional[str] = None


class SendDigestResult(BaseModel):
    channel: str   # "whatsapp" | "email" | "preview"
    delivery_ref: str


async def send_digest(ctx: FunctionContext, data: SendDigestInput) -> SendDigestResult:
    pod = Pod.from_env()

    phone = data.founder_phone or os.environ.get("HIREMIND_FOUNDER_PHONE")
    if phone:
        try:
            wa = pod.connectors.twilio_whatsapp
            res = wa.execute("send_message", {"to": phone, "body": data.message_text})
            return SendDigestResult(channel="whatsapp", delivery_ref=str(res.get("sid", "")))
        except Exception:
            pass

    email = data.founder_email or ctx.user_email
    if email:
        try:
            gmail = pod.connectors.gmail
            res = gmail.execute("send_email", {
                "to": [email],
                "subject": "Hiremind digest",
                "body": data.message_text,
            })
            return SendDigestResult(channel="email", delivery_ref=str(res.get("id", "")))
        except Exception:
            pass

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return SendDigestResult(channel="preview", delivery_ref=f"preview:{ts}")
