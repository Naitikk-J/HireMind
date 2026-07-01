#input_type_name: PollRepliesInput
#output_type_name: PollRepliesResult
#function_name: poll_replies

"""
Reply detection — PRD Flow C.

Polls Gmail every couple of minutes for new inbound messages in any thread
we've already sent outreach on. When it finds one:

  1. Records an `inbound` message row (idempotent — keyed on the Gmail
     message id we stash in `thread_ref`).
  2. Advances the candidate stage: `intro_sent` -> `replied`.
  3. Cancels pending `needs_followup` tasks for that candidate — they
     already replied, no point nagging the founder to chase.
  4. Classifies the reply ("interested" / "not_interested" / "scheduling"
     / "question") via a tiny keyword model so the operator's next action
     is concrete.

We use polling because the local stack runs at 127-0-0-1.sslip.io and Gmail
push notifications need a publicly-reachable HTTPS endpoint. Swap to
Gmail Pub/Sub + a webhook handler when the pod is deployed to a public host.

Inputs are intentionally empty — the function discovers what to check from
the candidates table. Take a single optional `candidate_id` to force a
re-poll of one candidate (useful for the "Refresh now" button later).
"""

import base64
import email
import re
from datetime import datetime, timezone
from email.message import EmailMessage
from typing import Any, Optional

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class PollRepliesInput(BaseModel):
    candidate_id: Optional[str] = Field(
        default=None,
        description="If provided, only check this candidate's thread. Useful for force-refresh from the UI.",
    )


class PollRepliesResult(BaseModel):
    candidates_checked: int
    new_replies: int
    skipped_threads: int


GMAIL_AUTH_CONFIG = "hiremind-gmail"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _to_dict(obj: Any) -> dict:
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "to_dict"):
        return obj.to_dict()
    return getattr(obj, "__dict__", {}) or {}


def _list_items(response: Any) -> list[Any]:
    if hasattr(response, "to_dict"):
        return response.to_dict().get("items") or []
    if isinstance(response, dict):
        return response.get("items") or []
    return getattr(response, "items", []) or []


def _connector_payload(result: Any) -> dict:
    """Connector operations sometimes return a wrapped envelope with
    .result, sometimes a direct dict. Normalise to a plain dict."""
    inner = getattr(result, "result", None) or getattr(result, "data", None) or result
    return _to_dict(inner)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- keyword reply classifier (deterministic, no LLM needed) --------------

_INTERESTED_RE = re.compile(
    r"\b("
    # Yes-family — tolerate common typos and emphatic variants ("yess", "yesss",
    # "yep", "yeah", "absolutely", "ofcourse"/"of course"). Real candidate
    # replies are conversational, not search-engine queries.
    r"y[ae]*h?|yep|yup|absolutely|definitely|of\s?course|ofcourse|"
    r"sure|happy\s+to|let'?s\s+(?:chat|talk|do\s+it)|interested|i'?m\s+in|"
    r"sounds\s+(?:good|great|interesting|like\s+a\s+plan)|i'?d\s+love|"
    r"send\s+(?:me\s+)?(?:a|the)\s+calendar|book\s+(?:a|the)\s+slot|"
    r"can\s+we\s+(?:hop|jump)\s+on|free\s+(?:next|this)\s+week|"
    r"down\s+to\s+chat|game\s+for\s+(?:a|that)"
    r")\b",
    re.IGNORECASE,
)

_NOT_INTERESTED_RE = re.compile(
    r"\b("
    r"no\s+thanks|not\s+(?:interested|looking|for\s+me|the\s+right\s+fit)|"
    r"happy\s+where\s+i\s+am|passing|pass\s+on|"
    r"unsubscribe|please\s+remove|stop\s+(?:sending|emailing|contacting)"
    r")\b",
    re.IGNORECASE,
)

_SCHEDULING_RE = re.compile(
    r"\b("
    r"when\s+(?:are\s+you|works|would)|what\s+time|schedule|"
    r"calendly|calendar\s+link|book\s+a\s+time|pick\s+a\s+slot"
    r")\b",
    re.IGNORECASE,
)

# Heuristics for Gmail / mailer-daemon bounce notifications. We detect by
# (a) the standard delivery-failure subject and (b) sender envelopes that
# include the well-known mailer-daemon / postmaster patterns. A single match
# is enough — better to false-positive a real reply with "delivery status"
# in the subject than to silently mark a candidate as "interested" when
# their email actually bounced.
_BOUNCE_FROM_RE = re.compile(
    r"\b(?:mailer[-_]?daemon|postmaster|mail\s+delivery\s+sub(?:system|server))\b",
    re.IGNORECASE,
)
_BOUNCE_SUBJECT_RE = re.compile(
    r"^(?:re:\s*)?(?:delivery\s+status\s+notification|undelivered\s+mail|"
    r"failure\s+notice|mail\s+delivery\s+failed|"
    r"returned\s+mail|message\s+not\s+delivered)",
    re.IGNORECASE,
)


def _is_bounce(*, from_header: str, subject: str) -> bool:
    return bool(
        _BOUNCE_FROM_RE.search(from_header or "")
        or _BOUNCE_SUBJECT_RE.search((subject or "").strip())
    )


def _classify_reply(body: str) -> str:
    """Return one of: 'interested' | 'not_interested' | 'scheduling' | 'question'."""
    if not body:
        return "question"
    if _NOT_INTERESTED_RE.search(body):
        return "not_interested"
    if _SCHEDULING_RE.search(body):
        return "scheduling"
    if _INTERESTED_RE.search(body):
        return "interested"
    # Lots of replies end with "?" — treat ambiguous text as a question so the
    # founder is nudged to reply themselves rather than auto-advance.
    if "?" in body:
        return "question"
    return "question"


def _next_action_from_class(classification: str, name: str) -> str:
    first = (name or "they").split()[0] if name else "they"
    return {
        "interested": f"{first} said yes — send a calendar link.",
        "scheduling": f"{first} wants to schedule — send Calendly / propose times.",
        "not_interested": f"{first} passed — move to closed with note.",
        "bounced": f"Email to {first} bounced — find a working address.",
        "question": f"{first} asked something — draft a reply.",
    }.get(classification, f"{first} replied — read and respond.")


# --- Gmail payload parsing ------------------------------------------------

def _decode_base64url(data: str) -> bytes:
    """Gmail body data is base64url, often without padding. Reconstitute it."""
    if not data:
        return b""
    pad = (-len(data)) % 4
    return base64.urlsafe_b64decode(data + ("=" * pad))


def _extract_body_from_payload(payload: dict) -> str:
    """Walk a Gmail MessagePart tree, prefer text/plain, fall back to text/html
    stripped to plain. We don't try to be exhaustive — we just want a
    readable chunk for the operator to scan."""
    if not payload:
        return ""

    def walk(part: dict, prefer: str) -> Optional[str]:
        mime = (part.get("mimeType") or "").lower()
        if mime == prefer:
            data = (part.get("body") or {}).get("data") or ""
            if data:
                try:
                    return _decode_base64url(data).decode("utf-8", errors="replace")
                except Exception:
                    return None
        for sub in part.get("parts") or []:
            found = walk(sub, prefer)
            if found:
                return found
        return None

    body = walk(payload, "text/plain")
    if body is None:
        body = walk(payload, "text/html") or ""
        body = re.sub(r"<[^>]+>", " ", body)
    body = re.sub(r"\r\n", "\n", body)
    # Trim the quoted previous-message tail so the operator's view is the
    # NEW content, not the whole thread.
    cutoff_markers = [
        "\nOn ", "\n-----Original Message-----", "\n> ", "\n--\n",
    ]
    for marker in cutoff_markers:
        idx = body.find(marker)
        if 0 < idx < len(body):
            body = body[:idx]
    return body.strip()


def _header(payload: dict, name: str) -> str:
    for h in (payload or {}).get("headers") or []:
        if (h.get("name") or "").lower() == name.lower():
            return h.get("value") or ""
    return ""


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


async def poll_replies(ctx: FunctionContext, data: PollRepliesInput) -> PollRepliesResult:
    pod = Pod.from_env()

    # Who are we? We need our own email to skip our own outbound copies
    # that re-appear in the thread (Gmail folds sent + received into one
    # conversation).
    try:
        prof = _connector_payload(
            pod.connectors.execute(GMAIL_AUTH_CONFIG, "get_profile", {"user_id": "me"})
        )
        our_email = (prof.get("emailAddress") or prof.get("email_address") or "").lower()
    except Exception:
        our_email = ""

    # Find candidates worth checking. The backend supports eq/ne/gt/gte/lt/lte/like/ilike
    # — there's no `in` operator — so we filter the stage allowlist in Python.
    cand_filter = [{"field": "status", "op": "eq", "value": "active"}]
    if data.candidate_id:
        cand_filter.append({"field": "id", "op": "eq", "value": data.candidate_id})

    candidates_resp = pod.records.list("candidates", limit=500, filter=cand_filter)
    # PRD: replies matter from intro_sent onward; we keep polling through
    # 'replied' / 'screen_done' so multi-turn threads keep updating.
    POLLABLE_STAGES = {"intro_sent", "replied", "screen_done"}
    candidates = [
        c for c in (_to_dict(x) for x in _list_items(candidates_resp))
        if c.get("stage") in POLLABLE_STAGES
    ]

    new_replies = 0
    skipped = 0

    for c in candidates:
        cand_id = c.get("id")
        if not cand_id:
            continue

        # Find the most recent outbound message we sent (we use its thread_ref
        # to know which Gmail conversation to scan).
        msgs_resp = pod.records.list(
            "messages",
            limit=100,
            filter=[
                {"field": "candidate_id", "op": "eq", "value": cand_id},
                {"field": "direction", "op": "eq", "value": "outbound"},
                {"field": "status", "op": "eq", "value": "sent"},
            ],
        )
        outbound = [_to_dict(m) for m in _list_items(msgs_resp)]
        outbound = [m for m in outbound if (m.get("thread_ref") or "").strip()]
        if not outbound:
            skipped += 1
            continue
        outbound.sort(key=lambda m: m.get("sent_at") or "", reverse=True)
        thread_id = outbound[0]["thread_ref"]
        if thread_id.startswith("preview:") or thread_id.startswith("failed:"):
            skipped += 1
            continue

        # IDs of inbound messages we've ALREADY recorded for this candidate.
        # We stash Gmail's per-message id (not the thread id) in the inbound
        # row's thread_ref column for dedup. We strip the "gmsg:" prefix
        # so it survives the messages_status_check + max_length=240 constraint.
        prior_inbound_resp = pod.records.list(
            "messages",
            limit=200,
            filter=[
                {"field": "candidate_id", "op": "eq", "value": cand_id},
                {"field": "direction", "op": "eq", "value": "inbound"},
            ],
        )
        seen_ids = set()
        for m in _list_items(prior_inbound_resp):
            tr = (_to_dict(m).get("thread_ref") or "")
            if tr.startswith("gmsg:"):
                seen_ids.add(tr[5:])

        # Pull the thread metadata, then for each new message fetch the body.
        try:
            thread_data = _connector_payload(pod.connectors.execute(
                GMAIL_AUTH_CONFIG,
                "threads_get",
                {"user_id": "me", "id": thread_id, "format": "metadata"},
            ))
        except Exception:
            skipped += 1
            continue

        thread_msgs = thread_data.get("messages") or []
        latest_classification: Optional[str] = None
        had_bounce = False
        had_real_reply = False

        for tm in thread_msgs:
            gmsg_id = (tm.get("id") or "").strip()
            if not gmsg_id or gmsg_id in seen_ids:
                continue

            try:
                msg_data = _connector_payload(pod.connectors.execute(
                    GMAIL_AUTH_CONFIG,
                    "messages_get",
                    {"user_id": "me", "id": gmsg_id, "format": "full"},
                ))
            except Exception:
                continue

            payload = msg_data.get("payload") or {}
            from_header = _header(payload, "From")
            # Skip our own sends — they're already represented as outbound.
            if our_email and our_email in from_header.lower():
                continue

            subject = _header(payload, "Subject")[:240]
            body = _extract_body_from_payload(payload)

            is_bounce = _is_bounce(from_header=from_header, subject=subject)
            classification = "bounced" if is_bounce else _classify_reply(body)
            latest_classification = classification
            if is_bounce:
                had_bounce = True
            else:
                had_real_reply = True

            pod.table("messages").create({
                "candidate_id": cand_id,
                "direction": "inbound",
                "channel": "email",
                "subject": subject,
                "body": (body or "")[:20000],
                # Bounces aren't a candidate "reply" — keep the audit trail
                # but mark differently so the Drafts/Activity views can
                # filter them out cleanly.
                "status": "failed" if is_bounce else "received",
                "thread_ref": f"gmsg:{gmsg_id}"[:240],
                "created_by": "poll_replies",
            })
            new_replies += 1

        # Advance candidate state based on what we actually found. Bounces
        # take precedence — if the email never made it, no point pretending
        # they "replied".
        if had_bounce and not had_real_reply:
            pod.table("candidates").update(cand_id, {
                # The address is dead — close the loop, no further outreach
                # from this contact info will work.
                "stage": "closed",
                "status": "passed",
                "next_action": _next_action_from_class("bounced", c.get("name") or ""),
            })
        elif had_real_reply and latest_classification is not None:
            new_stage = c.get("stage") or "intro_sent"
            new_status = c.get("status") or "active"
            if new_stage == "intro_sent":
                new_stage = "replied"
            if latest_classification == "not_interested":
                # Honour the explicit "no" — close the loop, don't waste them
                # on follow-up nagging.
                new_status = "passed"
                new_stage = "closed"

            pod.table("candidates").update(cand_id, {
                "stage": new_stage,
                "status": new_status,
                "last_contact": _now_iso(),
                "next_action": _next_action_from_class(latest_classification, c.get("name") or ""),
            })

            # Cancel pending follow-up tasks for this candidate — they replied.
            tasks_resp = pod.records.list(
                "tasks",
                limit=50,
                filter=[
                    {"field": "candidate_id", "op": "eq", "value": cand_id},
                    {"field": "type", "op": "eq", "value": "needs_followup"},
                    {"field": "status", "op": "eq", "value": "pending"},
                ],
            )
            for t in _list_items(tasks_resp):
                t_dict = _to_dict(t)
                try:
                    pod.table("tasks").update(t_dict["id"], {"status": "cancelled"})
                except Exception:
                    # A tasks-table racy update isn't fatal — the poll already
                    # did the important work (persisted the reply).
                    pass

    return PollRepliesResult(
        candidates_checked=len(candidates),
        new_replies=new_replies,
        skipped_threads=skipped,
    )
