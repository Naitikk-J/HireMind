#input_type_name: SendOutreachInput
#output_type_name: SendOutreachResult
#function_name: send_outreach

import base64
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod


class SendOutreachInput(BaseModel):
    message_id: str


class SendOutreachResult(BaseModel):
    message_id: str
    thread_ref: str
    candidate_id: str
    new_stage: str
    mode: str  # "live" | "preview"


def _build_raw_email(*, to_email: str, subject: str, body_text: str) -> str:
    """Build a base64url-encoded RFC 2822 message for Gmail's messages_send.

    Gmail's API takes a single ``raw`` field — the whole MIME envelope encoded.
    We let Python's ``email`` package handle headers/encoding correctly, then
    base64url-encode without padding (Gmail strips '=' padding).
    """
    msg = EmailMessage()
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body_text)
    raw_bytes = msg.as_bytes()
    return base64.urlsafe_b64encode(raw_bytes).decode("ascii").rstrip("=")


GMAIL_AUTH_CONFIG = "hiremind-gmail"


def _try_send_via_gmail(pod: Pod, msg: dict, to_email: str) -> tuple[str, str, str | None]:
    """Attempt live send via lemma's native Gmail connector.

    Uses ``pod.connectors.execute(auth_config, operation, payload)`` — the
    first arg is the *auth-config name* registered against the org, NOT the
    connector id.

    Returns ``(mode, thread_ref, error)``. ``mode`` is "live" on success,
    "preview" if no auth config is wired (the pre-deploy state), or "failed"
    if the call errored — in which case ``error`` holds the upstream message.
    """
    auth_configs = pod.connectors.auth_configs.list()
    items = getattr(auth_configs, "items", None) or []
    has_gmail_auth = any(
        getattr(ac, "name", None) == GMAIL_AUTH_CONFIG
        and getattr(ac, "connector_id", None) == "gmail"
        for ac in items
    )
    if not has_gmail_auth:
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        return (
            "preview",
            f"preview:{ts}",
            f"no auth config named {GMAIL_AUTH_CONFIG!r} for the gmail connector",
        )

    raw = _build_raw_email(
        to_email=to_email,
        subject=msg.get("subject") or "Quick note",
        body_text=msg["body"],
    )
    body_payload: dict = {"raw": raw}
    existing_thread = (msg.get("thread_ref") or "").strip()
    if existing_thread and not existing_thread.startswith("preview:"):
        body_payload["threadId"] = existing_thread

    try:
        result = pod.connectors.execute(
            GMAIL_AUTH_CONFIG,
            "messages_send",
            {"user_id": "me", "body": body_payload},
        )
    except Exception as exc:
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        return "failed", f"failed:{ts}", f"gmail_send_error: {exc!s}"

    data = getattr(result, "result", None) or getattr(result, "data", None) or result
    data = data if isinstance(data, dict) else getattr(data, "__dict__", {}) or {}
    thread_ref = (
        data.get("threadId")
        or data.get("thread_id")
        or data.get("id")
        or ""
    )
    return "live", str(thread_ref), None


async def send_outreach(ctx: FunctionContext, data: SendOutreachInput) -> SendOutreachResult:
    pod = Pod.from_env()

    msg = pod.table("messages").get(data.message_id)

    # Status guard with graceful recovery:
    # - awaiting_approval (the happy path) → send below
    # - sent without a thread_ref → an upstream code path flipped the flag
    #   without completing the send side-effects. We treat this as
    #   "complete the half-finished send": stamp thread_ref, advance stage,
    #   create the follow-up task. Idempotent — running twice is safe.
    # - sent WITH a thread_ref → already fully sent; no-op success.
    # - any other status (ignored, declined, etc) → refuse cleanly.
    status = msg.get("status", "")
    existing_thread = msg.get("thread_ref") or ""
    if status == "sent" and existing_thread and not existing_thread.startswith("preview:"):
        candidate = pod.table("candidates").get(msg["candidate_id"])
        return SendOutreachResult(
            message_id=data.message_id,
            thread_ref=existing_thread,
            candidate_id=str(candidate["id"]),
            new_stage=candidate["stage"],
            mode="already_sent",
        )
    if status not in ("awaiting_approval", "sent"):
        raise ValueError(
            f"Refusing to send: message {data.message_id} is in status '{status}', "
            f"expected 'awaiting_approval'."
        )

    candidate = pod.table("candidates").get(msg["candidate_id"])
    to_email = candidate.get("email")
    if not to_email:
        raise ValueError(
            f"Candidate {candidate['id']} ({candidate['name']}) has no email — cannot send outbound."
        )

    mode, thread_ref, send_error = _try_send_via_gmail(pod, msg, to_email)

    if mode == "failed":
        # Bubble the upstream Gmail error up to the caller so the operator UI
        # surfaces "what actually went wrong" instead of a silent preview.
        # We still mark the row 'failed' (a valid status) for the audit trail
        # before raising.
        pod.table("messages").update(data.message_id, {
            "status": "failed",
            "approved_by_user_id": ctx.user_id,
        })
        raise RuntimeError(send_error or "gmail_send_error: unknown")

    now = datetime.now(timezone.utc).isoformat()
    # Map our internal modes back to one of the table's allowed statuses.
    # 'preview' isn't a real send — leave the row as 'awaiting_approval' so the
    # founder can re-tap Send once the gmail connector is wired.
    if mode == "live":
        new_status = "sent"
    else:  # mode == "preview" — connector not wired
        new_status = "awaiting_approval"

    pod.table("messages").update(data.message_id, {
        "status": new_status,
        "approved_by_user_id": ctx.user_id,
        "sent_at": now if mode == "live" else None,
        "thread_ref": thread_ref if mode == "live" else "",
    })

    # Stage routing keyed off the message's intent. The kanban now has explicit
    # screening and offer columns, and each outbound message kind moves the
    # candidate to a deterministic next state when it actually leaves the pod:
    #   - intro:              sourced/reviewed → intro_sent
    #   - screening_request:  no auto-move (founder decides Complete/Rejected)
    #   - offer_letter:       any → offer
    # Anything we don't recognise falls back to the legacy intro behaviour.
    intent = (msg.get("intent") or "intro").strip().lower() or "intro"
    current_stage = candidate["stage"]
    new_stage = current_stage
    new_status: str = candidate.get("status") or "active"
    next_action_after_send = "Wait for reply (4 days)"
    if mode == "live":
        if intent == "rejection":
            # Sending the rejection IS the close-out. Status flips to declined
            # (the candidate is out of the active pipeline) and stage moves to
            # `closed` — the wire-enum value the UI labels as "Rejected". We
            # only do this once the email actually left the pod, otherwise a
            # preview-mode draft would silently close the candidate without
            # them ever being told.
            new_stage = "closed"
            new_status = "declined"
            next_action_after_send = "Rejection sent — candidate kept for the record"
        elif intent == "offer_letter":
            new_stage = "offer"
            next_action_after_send = "Wait for offer response (up to 7 days)"
        elif intent == "screening_request":
            # Stay where they are — usually `replied`. The founder explicitly
            # advances them via Screening Complete / Rejected.
            new_stage = current_stage
            next_action_after_send = "Awaiting screening materials — mark Complete or Rejected when done."
        else:  # intro (or unknown)
            if current_stage in ("sourced", "reviewed"):
                new_stage = "intro_sent"
    candidate_update: dict = {"stage": new_stage}
    if mode == "live":
        candidate_update["last_contact"] = now
        candidate_update["next_action"] = next_action_after_send
        if new_status != (candidate.get("status") or "active"):
            candidate_update["status"] = new_status
    pod.table("candidates").update(candidate["id"], candidate_update)

    if mode == "live" and intent != "rejection":
        # Follow-up cadence depends on what we just sent. Skipped entirely
        # for rejections — the candidate is out of the pipeline, chasing
        # them is the opposite of what the founder wants.
        #   intro              → 4 days (cold outreach decay).
        #   screening_request  → 3 days (we're already in conversation; faster
        #                        nudge if they go quiet).
        #   offer_letter       → 7 days (give them space to think).
        if intent == "offer_letter":
            followup_days, followup_title = 7, f"Nudge {candidate['name']} on the offer if no response"
        elif intent == "screening_request":
            followup_days, followup_title = 3, f"Nudge {candidate['name']} for screening materials"
        else:
            followup_days, followup_title = 4, f"Follow up with {candidate['name']} if no reply"

        due = (datetime.now(timezone.utc) + timedelta(days=followup_days)).isoformat()
        pod.table("tasks").create({
            "type": "needs_followup",
            "owner_user_id": ctx.user_id,
            "candidate_id": candidate["id"],
            "title": followup_title,
            "due": due,
            "status": "pending",
            "created_by": "send_outreach",
            "context_ref": {"message_id": data.message_id, "thread_ref": thread_ref, "mode": mode, "intent": intent},
        })

    return SendOutreachResult(
        message_id=data.message_id,
        thread_ref=thread_ref,
        candidate_id=str(candidate["id"]),
        new_stage=new_stage,
        mode=mode,
    )
