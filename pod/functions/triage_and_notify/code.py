#input_type_name: TriageAndNotifyInput
#output_type_name: TriageAndNotifyResult
#function_name: triage_and_notify

"""
Triage a freshly-created candidate and email the founder with a verdict.

This is the back-half of the "anything-dropper" flow described in the PRD:
intake parses → candidate row + dossier exist → THIS function reads the
score, decides suitable/not suitable, persists the decision on the row, and
sends a single email to the founder summarising why and what to do next.

Design choices:
  * Deterministic — no LLM. The score + matched-keywords data from
    parse_intake is already plenty for a useful verdict. An LLM can rewrite
    the prose later.
  * One email per intake (not one digest at end of day) so the founder gets
    a real-time signal — which the PRD calls out as the wedge over inbox-
    based workflows.
  * Every intake stays on the kanban regardless of score. The score is a
    signal in the email + the `next_action` cell, NOT a filter — the founder
    is the one who decides who to reject, never this function. Low-score
    candidates still ride in as status="active" and can be dismissed (or
    promoted) from the board.
"""

import base64
import os
from datetime import datetime, timezone
from email.message import EmailMessage
from typing import Any, Optional

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class TriageAndNotifyInput(BaseModel):
    candidate_id: str
    # Score >= this is "suitable". Default 5.0 — matches parse_intake's base
    # of 2.5 plus at least one must-have match, which is the right floor for
    # "worth a founder's attention".
    suitable_threshold: float = Field(default=5.0, ge=0, le=10)


class TriageAndNotifyResult(BaseModel):
    candidate_id: str
    verdict: str  # "suitable" | "not_suitable"
    score: float
    email_mode: str  # "live" | "preview" | "failed"
    email_thread_ref: str
    founder_email: str


GMAIL_AUTH_CONFIG = "hiremind-gmail"


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


def _resolve_founder_email(pod: Pod) -> str:
    """Find the right inbox to ping.

    Order of preference:
      1. ``HIREMIND_FOUNDER_EMAIL`` env var (explicit override).
      2. The Gmail account currently connected to this org — pulled via
         the connector's ``get_profile`` op. This is the natural default:
         the founder owns their Gmail, so emailing 'themselves' lands in
         the same inbox they already live in.
    """
    explicit = (os.environ.get("HIREMIND_FOUNDER_EMAIL") or "").strip()
    if explicit:
        return explicit

    profile = pod.connectors.execute(
        GMAIL_AUTH_CONFIG, "get_profile", {"user_id": "me"}
    )
    profile_data = _to_dict(getattr(profile, "result", None) or getattr(profile, "data", None) or profile)
    email = profile_data.get("emailAddress") or profile_data.get("email_address") or ""
    if not email:
        raise RuntimeError(
            "Could not resolve founder email: set HIREMIND_FOUNDER_EMAIL or "
            "ensure the gmail connector is connected for this org."
        )
    return str(email)


def _build_raw_email(*, to_email: str, subject: str, body_text: str) -> str:
    msg = EmailMessage()
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body_text)
    return base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii").rstrip("=")


def _extract_dossier_highlights(dossier: str) -> dict[str, list[str]]:
    """Pull the "Why interesting" + "Concerns" bullet lists out of the
    dossier markdown so we can quote them in the email without duplicating
    the full doc. Tolerant of formatting drift — looks for the section
    heading then collects bullet lines until the next heading.
    """
    sections: dict[str, list[str]] = {"why": [], "concerns": [], "talking": []}
    if not dossier:
        return sections

    current: Optional[str] = None
    for line in dossier.splitlines():
        stripped = line.strip()
        lower = stripped.lower()
        if lower.startswith("##") or lower.startswith("###"):
            if "why interesting" in lower:
                current = "why"
            elif "concern" in lower:
                current = "concerns"
            elif "talking point" in lower:
                current = "talking"
            else:
                current = None
            continue
        if current and (stripped.startswith("- ") or stripped.startswith("* ")):
            sections[current].append(stripped[2:].strip())
    return sections


def _resolve_role_label(pod: Pod, role_id: Optional[str]) -> str:
    if not role_id:
        return "(no role assigned)"
    try:
        role_dict = _to_dict(pod.records.get("roles", role_id))
        return role_dict.get("title") or role_dict.get("slug") or "(unknown role)"
    except Exception:
        return "(unknown role)"


def _build_email_body(
    *,
    verdict: str,
    candidate: dict,
    role_label: str,
    threshold: float,
    highlights: dict[str, list[str]],
    operator_url: str,
) -> tuple[str, str]:
    """Return (subject, plaintext body). Deliberately plain — the founder
    reads this on their phone, often mid-meeting. Three lines of context,
    then the action."""
    name = candidate.get("name") or "Unknown candidate"
    score = float(candidate.get("score") or 0.0)
    source = candidate.get("source") or "manual"
    linkedin = candidate.get("linkedin_url") or ""
    email_addr = candidate.get("email") or ""

    if verdict == "suitable":
        subject = f"[Hiremind] {name} looks like a fit — {score:.1f}/10 for {role_label}"
        header = f"You have a new strong candidate for {role_label}."
        action_line = (
            "Open them in Hiremind to read the dossier and draft the first message:\n"
            f"  {operator_url}"
        )
    else:
        subject = f"[Hiremind] {name} — low signal ({score:.1f}/10) for {role_label}"
        header = (
            f"New candidate for {role_label} — scored {score:.1f}/10, below the "
            f"{threshold:.1f} suggestion bar. They're on the kanban for you to "
            "look at; reject from there if it's a clear pass."
        )
        action_line = (
            "Open them and decide — reject in one click if it's a no, or move "
            "forward if the score undersold them:\n"
            f"  {operator_url}"
        )

    contact_bits = []
    if email_addr:
        contact_bits.append(f"email: {email_addr}")
    if linkedin:
        contact_bits.append(linkedin)
    contact_line = ("  " + " · ".join(contact_bits)) if contact_bits else "  (no contact info found)"

    why_block = "\n".join(f"  - {b}" for b in highlights.get("why", [])[:4]) or "  (none extracted)"
    concerns_block = "\n".join(f"  - {b}" for b in highlights.get("concerns", [])[:3]) or "  (none flagged)"

    body = "\n".join([
        header,
        "",
        f"Candidate: {name}",
        f"Source:    {source}",
        f"Score:     {score:.1f}/10",
        "Contact:",
        contact_line,
        "",
        "Why interesting:",
        why_block,
        "",
        "Concerns:",
        concerns_block,
        "",
        action_line,
        "",
        "— Hiremind",
    ])
    return subject, body


def _send_via_gmail(pod: Pod, *, to_email: str, subject: str, body_text: str) -> tuple[str, str]:
    """Returns (mode, thread_ref).

    Unlike send_outreach, we DO swallow gmail errors here — failing to notify
    shouldn't roll back the candidate intake. We just record 'failed' so the
    operator can see the issue in the function-run log.
    """
    auth_configs = pod.connectors.auth_configs.list()
    items = _list_items(auth_configs)
    has_gmail = False
    for ac in items:
        ac_dict = _to_dict(ac)
        if ac_dict.get("name") == GMAIL_AUTH_CONFIG and ac_dict.get("connector_id") == "gmail":
            has_gmail = True
            break
    if not has_gmail:
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        return "preview", f"preview:{ts}"

    raw = _build_raw_email(to_email=to_email, subject=subject, body_text=body_text)
    try:
        result = pod.connectors.execute(
            GMAIL_AUTH_CONFIG,
            "messages_send",
            {"user_id": "me", "body": {"raw": raw}},
        )
    except Exception as exc:
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        # Surface the error in the thread_ref so the function-run log makes
        # the failure debuggable without a separate tracing system.
        return "failed", f"failed:{ts}:{exc!s}"[:240]

    payload = _to_dict(getattr(result, "result", None) or getattr(result, "data", None) or result)
    return "live", str(payload.get("threadId") or payload.get("id") or "")


async def triage_and_notify(ctx: FunctionContext, data: TriageAndNotifyInput) -> TriageAndNotifyResult:
    pod = Pod.from_env()

    candidate = _to_dict(pod.records.get("candidates", data.candidate_id))
    score = float(candidate.get("score") or 0.0)
    verdict = "suitable" if score >= data.suitable_threshold else "not_suitable"

    role_label = _resolve_role_label(pod, candidate.get("role_id"))

    dossier_path = candidate.get("dossier_path") or ""
    dossier_text = ""
    if dossier_path:
        try:
            dossier_bytes = pod.files.download(dossier_path)
            dossier_text = dossier_bytes.decode("utf-8", errors="replace")
        except Exception:
            dossier_text = ""
    highlights = _extract_dossier_highlights(dossier_text)

    # The operator app URL is config-driven so this works in both local
    # (sslip.io) and cloud (lemma.work) deployments.
    operator_base = (os.environ.get("HIREMIND_OPERATOR_URL") or "http://operator.127-0-0-1.sslip.io:8711").rstrip("/")
    operator_url = f"{operator_base}/candidates/{candidate['id']}"

    founder_email = _resolve_founder_email(pod)

    subject, body = _build_email_body(
        verdict=verdict,
        candidate=candidate,
        role_label=role_label,
        threshold=data.suitable_threshold,
        highlights=highlights,
        operator_url=operator_url,
    )
    mode, thread_ref = _send_via_gmail(
        pod, to_email=founder_email, subject=subject, body_text=body,
    )

    if verdict == "not_suitable":
        # Surface the low score in the `next_action` cell so the operator
        # sees the suggestion when scanning the kanban — but keep the row
        # `active`. The founder is the one who decides to pass; this
        # function does not auto-archive based on score.
        pod.table("candidates").update(data.candidate_id, {
            "next_action": (
                f"Low signal ({score:.1f}/10, below {data.suitable_threshold:.1f}) "
                "— review and reject if it's a clear pass"
            ),
        })

    return TriageAndNotifyResult(
        candidate_id=str(candidate["id"]),
        verdict=verdict,
        score=score,
        email_mode=mode,
        email_thread_ref=thread_ref,
        founder_email=founder_email,
    )
