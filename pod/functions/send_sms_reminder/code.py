#input_type_name: SendSmsReminderInput
#output_type_name: SendSmsReminderResult
#function_name: send_sms_reminder

"""
Send an SMS reminder to a candidate via Twilio.

Why direct HTTP (no Lemma connector):
  Twilio isn't in Lemma's Composio connector catalog — the closest match
  is Segment (a Twilio subsidiary but for analytics, not SMS). So we
  call Twilio's REST API directly with basic-auth using
  Account SID + Auth Token, loaded from pod secrets:

    TWILIO_ACCOUNT_SID  (env)
    TWILIO_AUTH_TOKEN   (env)
    TWILIO_FROM_NUMBER  (env — E.164 format, e.g. +14155552671)

  Set these once via the pod's secrets panel; every function in the pod
  can then read them via `os.environ`.

Typical use case:
  30-minute reminder before a screen. `interview_id` is optional — pass
  it and we look up the scheduled_at + meet_url automatically.
"""

import base64
import json
import os
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class SendSmsReminderInput(BaseModel):
    candidate_id: str
    interview_id: Optional[str] = Field(
        default=None,
        description="When provided, we build the default body from the interview row (scheduled_at + meet_url). Otherwise `body` is required.",
    )
    body: Optional[str] = Field(default=None, description="Explicit SMS body. Overrides the auto-composed reminder.")
    to_number_override: Optional[str] = Field(default=None, description="Explicit E.164 phone number. If missing we read candidate.phone.")


class SendSmsReminderResult(BaseModel):
    candidate_id: str
    to_number: str
    body: str
    twilio_sid: str
    status: str
    message_row_id: str
    mode: str  # "live" | "missing_secrets" | "missing_number" | "failed"


def _to_dict(obj: Any) -> dict:
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "to_dict"):
        return obj.to_dict()
    return getattr(obj, "__dict__", {}) or {}


_E164_RE = re.compile(r"^\+[1-9]\d{6,14}$")


def _clean_phone(raw: str) -> str:
    """Normalise to E.164. Strip spaces/dashes/parens; if starts with '00'
    replace with '+'; if starts with a digit and looks like a US number,
    prepend '+1'. Anything else — return empty and let the caller show
    an error."""
    if not raw:
        return ""
    s = re.sub(r"[\s\-().]", "", raw.strip())
    if s.startswith("00"):
        s = "+" + s[2:]
    if not s.startswith("+"):
        digits = re.sub(r"\D", "", s)
        if len(digits) == 10:
            s = "+1" + digits
        elif len(digits) == 11 and digits.startswith("1"):
            s = "+" + digits
        else:
            s = "+" + digits
    return s if _E164_RE.fullmatch(s) else ""


def _compose_body_from_interview(candidate_name: str, interview: dict) -> str:
    when_iso = str(interview.get("scheduled_at") or "")
    meet = str(interview.get("meet_url") or "")
    when_pretty = when_iso
    try:
        dt = datetime.fromisoformat(when_iso.replace("Z", "+00:00"))
        when_pretty = dt.strftime("%a %b %d at %H:%M %Z").strip()
    except Exception:
        pass
    parts = [
        f"Hi {candidate_name.split()[0] if candidate_name else 'there'} —",
        f"quick reminder: our chat is at {when_pretty}.",
    ]
    if meet:
        parts.append(f"Join: {meet}")
    parts.append("— Naitik")
    return "\n".join(parts)


def _twilio_send(*, account_sid: str, auth_token: str, from_number: str, to_number: str, body: str) -> dict:
    """POST to Twilio's Messages API. Raises RuntimeError with the
    Twilio error body on non-2xx."""
    url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
    form = urllib.parse.urlencode({"From": from_number, "To": to_number, "Body": body}).encode("utf-8")
    creds = base64.b64encode(f"{account_sid}:{auth_token}".encode("utf-8")).decode("ascii")
    req = urllib.request.Request(
        url,
        data=form,
        headers={
            "Authorization": f"Basic {creds}",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "User-Agent": "hiremind/1.0 (+lemma)",
        },
        method="POST",
    )
    try:
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
            body_bytes = resp.read()
            return json.loads(body_bytes.decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8", errors="replace")
        except Exception:
            detail = ""
        raise RuntimeError(f"Twilio HTTP {e.code}: {detail or e.reason}")
    except Exception as exc:
        raise RuntimeError(f"Twilio request failed: {exc!s}")


async def send_sms_reminder(ctx: FunctionContext, data: SendSmsReminderInput) -> SendSmsReminderResult:
    pod = Pod.from_env()

    account_sid = os.environ.get("TWILIO_ACCOUNT_SID", "").strip()
    auth_token = os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
    from_number = os.environ.get("TWILIO_FROM_NUMBER", "").strip()
    if not (account_sid and auth_token and from_number):
        return SendSmsReminderResult(
            candidate_id=data.candidate_id,
            to_number="",
            body="",
            twilio_sid="",
            status="",
            message_row_id="",
            mode="missing_secrets",
        )

    candidate = _to_dict(pod.records.get("candidates", data.candidate_id))
    if not candidate:
        raise ValueError(f"Candidate {data.candidate_id} not found.")
    candidate_name = str(candidate.get("name") or "")

    to_raw = data.to_number_override or candidate.get("phone") or candidate.get("phone_number") or ""
    to_number = _clean_phone(str(to_raw))
    if not to_number:
        return SendSmsReminderResult(
            candidate_id=data.candidate_id,
            to_number="",
            body="",
            twilio_sid="",
            status="",
            message_row_id="",
            mode="missing_number",
        )

    body = (data.body or "").strip()
    if not body and data.interview_id:
        try:
            interview = _to_dict(pod.records.get("interviews", data.interview_id))
            if interview:
                body = _compose_body_from_interview(candidate_name, interview)
        except Exception:
            pass
    if not body:
        body = f"Hi {candidate_name or 'there'} — Naitik from Hiremind here, following up on our conversation."

    # Twilio SMS bodies over 1600 chars get truncated; keep it well under.
    body = body[:1500]

    try:
        result = _twilio_send(
            account_sid=account_sid,
            auth_token=auth_token,
            from_number=from_number,
            to_number=to_number,
            body=body,
        )
    except Exception as exc:
        raise RuntimeError(f"SMS send failed: {exc!s}")

    twilio_sid = str(result.get("sid") or "")
    status = str(result.get("status") or "")

    row_id = ""
    try:
        created = pod.table("messages").create(
            {
                "candidate_id": data.candidate_id,
                "direction": "outbound",
                "channel": "sms",
                "status": "sent" if status in {"queued", "sent", "sending", "delivered"} else "failed",
                "subject": "SMS reminder",
                "body": body,
                "sent_at": datetime.now(timezone.utc).isoformat(),
                "external_id": twilio_sid,
            }
        )
        row_id = str(created["id"]) if isinstance(created, dict) else str(getattr(created, "id"))
    except Exception:
        row_id = ""

    return SendSmsReminderResult(
        candidate_id=data.candidate_id,
        to_number=to_number,
        body=body,
        twilio_sid=twilio_sid,
        status=status,
        message_row_id=row_id,
        mode="live",
    )
