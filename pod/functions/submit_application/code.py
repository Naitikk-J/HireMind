#input_type_name: SubmitApplicationInput
#output_type_name: SubmitApplicationResult
#function_name: submit_application

"""
Public endpoint behind the candidate-facing apply form.

This is the only function in the pod that an unauthenticated browser can
hit — everything else assumes an operator session. The cost of that
openness is that we have to be paranoid about:

  1. **Bad input** — bots, copy-paste accidents, malformed emails.
     We validate length + format aggressively and refuse before any write.

  2. **Duplicate submits** — the candidate hits the button twice, the form
     is reloaded mid-network, the browser auto-resubmits the POST. We
     dedupe on (email, role_slug) within a 5-minute window so the
     pipeline doesn't fill up with phantom dupes.

  3. **Silent enrichment** — the apply form gives us name + email +
     linkedin + a 'why this role' paragraph. That's enough to write a
     real dossier skeleton in the same shape parse_intake produces, so
     the founder sees a recognisable card on the kanban (not a stub).

The function returns the new candidate_id + public_token. The apply page
uses both to render a 'we got it' confirmation that deep-links to the
candidate's own status page (`/c/<token>`) — the same one we send via
email after intro. That continuity is intentional: the candidate's first
contact with the company is a working portal, not a dead end.
"""

import re
import secrets
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class SubmitApplicationInput(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    email: str = Field(..., min_length=5, max_length=180)
    linkedin_url: Optional[str] = Field(default=None, max_length=300)
    role_slug: Optional[str] = Field(default=None, max_length=80)
    why: str = Field(
        default="",
        max_length=2000,
        description="Candidate's free-form 'why this role' paragraph.",
    )
    portfolio_url: Optional[str] = Field(default=None, max_length=300)


class SubmitApplicationResult(BaseModel):
    candidate_id: str
    public_token: str
    candidate_status_path: str
    role_title: Optional[str]
    deduped: bool = Field(
        default=False,
        description="True if we matched an existing recent submission instead of creating a new one.",
    )


_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")
_LINKEDIN_RE = re.compile(r"^https?://(?:[a-z]{2,3}\.)?linkedin\.com/in/[A-Za-z0-9._\-/%]+/?$", re.IGNORECASE)
_TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:40] or "candidate"


def _generate_public_token(name: str) -> str:
    suffix = "".join(secrets.choice(_TOKEN_ALPHABET) for _ in range(6))
    return f"{_slugify(name)}-{suffix}"


def _list_items(response: Any) -> list[dict[str, Any]]:
    if hasattr(response, "to_dict"):
        return response.to_dict().get("items") or []
    if isinstance(response, dict):
        return response.get("items") or []
    return list(getattr(response, "items", []) or [])


def _validate_or_raise(data: SubmitApplicationInput) -> None:
    if not _EMAIL_RE.match(data.email.strip()):
        raise ValueError("Please double-check the email address — that doesn't look quite right.")
    if data.linkedin_url and not _LINKEDIN_RE.match(data.linkedin_url.strip()):
        # We accept non-LinkedIn URLs as portfolio_url instead; the operator
        # can move them after. Refuse if the field is OBVIOUSLY a typo
        # (mailto:, javascript:, etc).
        lu = data.linkedin_url.strip().lower()
        if lu.startswith(("mailto:", "javascript:", "data:")):
            raise ValueError("That LinkedIn URL looks malformed — please paste the full https://linkedin.com/in/… link.")
    name = data.name.strip()
    if len(name.split()) < 1 or len(name) < 2:
        raise ValueError("Please share your full name so we know who you are.")


def _compose_dossier(*, data: SubmitApplicationInput, role_title: str, public_token: str) -> str:
    """Produce a parse_intake-compatible dossier skeleton from the form input.

    The shape matches what triage_and_notify / draft_outreach expect:
      - leading auto-summary paragraph (used by Compare's Summary block)
      - ## Why interesting (used as positive signal everywhere)
      - ## Concerns (left empty — founder fills after first read)
      - ## Talking points (auto-derived from the 'why' paragraph)
      - Raw application footer (the verbatim 'why' paragraph for posterity)
    """
    name = data.name.strip()
    role_label = role_title or "the role"
    why_clean = (data.why or "").strip()

    # Auto-summary: one paragraph the operator can scan in 3 seconds.
    pieces: list[str] = []
    pieces.append(f"{name} applied via the public form for {role_label}.")
    if data.linkedin_url:
        pieces.append(f"LinkedIn: {data.linkedin_url.strip()}.")
    if data.portfolio_url:
        pieces.append(f"Portfolio: {data.portfolio_url.strip()}.")
    if why_clean:
        excerpt = why_clean if len(why_clean) <= 180 else why_clean[:177].rstrip() + "…"
        pieces.append(f'Their pitch: "{excerpt}"')
    summary = " ".join(pieces)

    # Talking points: split the 'why' paragraph into the 2-3 most concrete
    # sentences. We don't try to be clever — first 3 sentences with at least
    # one ≥5-char word survive. Keeps the dossier honest to what the
    # candidate actually wrote without inventing facts.
    talking: list[str] = []
    for sent in re.split(r"(?<=[.!?])\s+", why_clean):
        s = sent.strip()
        if not s or len(s) < 20:
            continue
        if not re.search(r"\b[a-zA-Z]{5,}\b", s):
            continue
        talking.append(s.rstrip("."))
        if len(talking) >= 3:
            break

    # "Why interesting" — derived ONLY if we have something concrete to say.
    # Self-submitted applications haven't been vetted, so we keep this
    # section honest: presence of a portfolio link is signal, the act of
    # writing a non-trivial pitch is signal. Inventing strengths would
    # poison the rejection drafter downstream.
    why_bullets: list[str] = []
    if data.portfolio_url:
        why_bullets.append(f"Submitted portfolio: {data.portfolio_url.strip()} — review for evidence of shipped work.")
    if data.linkedin_url:
        why_bullets.append(f"LinkedIn profile attached — confirm seniority + last 2 roles match what {role_label} needs.")
    if len(why_clean) >= 120:
        why_bullets.append("Took the time to write a real pitch (≥120 chars) rather than auto-submitting.")

    lines: list[str] = []
    lines.append(f"# {name}")
    lines.append("")
    lines.append(summary)
    lines.append("")
    lines.append("## Why interesting")
    if why_bullets:
        for b in why_bullets:
            lines.append(f"- {b}")
    else:
        lines.append("- (No evidence attached — public-form submission without supporting links. Review the verbatim pitch below before deciding.)")
    lines.append("")
    lines.append("## Concerns")
    lines.append("- Unverified — self-submitted via the public apply form. Treat claims as unconfirmed until first conversation.")
    lines.append("")
    lines.append("## Talking points")
    if talking:
        for t in talking:
            lines.append(f"- {t}")
    else:
        lines.append("- Why this role specifically? (Open with this — their pitch was thin.)")
    lines.append("")
    lines.append("---")
    lines.append(f"_Submitted via public apply form · public token `{public_token}`_")
    if why_clean:
        lines.append("")
        lines.append("### Verbatim pitch")
        lines.append("")
        for paragraph in why_clean.split("\n"):
            lines.append(paragraph)
    return "\n".join(lines)


def _maybe_dedupe(
    pod: Pod,
    email: str,
    role_id: Optional[str],
    window: timedelta,
) -> Optional[dict]:
    """Return an existing candidate row if (email, role_id) matches a record
    created within `window`. Used to swallow accidental double-submits.

    We MATCH ON ROLE — different roles legitimately get different
    applications from the same person and shouldn't be collapsed.
    """
    try:
        resp = pod.records.list(
            "candidates",
            limit=5,
            filter=[{"field": "email", "op": "eq", "value": email}],
        )
    except Exception:
        return None
    items = _list_items(resp)
    if not items:
        return None
    now = datetime.now(timezone.utc)
    for row in items:
        if role_id and row.get("role_id") != role_id:
            continue
        if not role_id and row.get("role_id"):
            # Caller had no role_slug. Only collapse against other roleless
            # rows — collapsing across roles would lose intent.
            continue
        created = row.get("created_at") or row.get("createdAt") or ""
        if not created:
            return row
        try:
            created_dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
        except Exception:
            return row
        if (now - created_dt) <= window:
            return row
    return None


async def submit_application(
    ctx: FunctionContext,
    data: SubmitApplicationInput,
) -> SubmitApplicationResult:
    _validate_or_raise(data)
    pod = Pod.from_env()
    email_norm = data.email.strip().lower()
    name = data.name.strip()

    # Resolve role from slug. Public form is allowed to NOT include a slug
    # (general-interest applications) — those land in the kanban without a
    # role assignment and the operator routes them by hand.
    role_id: Optional[str] = None
    role_title: Optional[str] = None
    if data.role_slug:
        try:
            roles_resp = pod.records.list(
                "roles",
                limit=1,
                filter=[{"field": "slug", "op": "eq", "value": data.role_slug.strip()}],
            )
            role_items = _list_items(roles_resp)
            if role_items:
                role_id = role_items[0]["id"]
                role_title = role_items[0].get("title")
        except Exception:
            role_id = None
            role_title = None

    # Dedupe window: 5 min. Long enough to catch double-clicks and stale
    # browser back-button resubmits; short enough that a candidate who
    # genuinely re-applies later (after a real edit) still gets through.
    existing = _maybe_dedupe(pod, email_norm, role_id, window=timedelta(minutes=5))
    if existing:
        return SubmitApplicationResult(
            candidate_id=str(existing["id"]),
            public_token=existing.get("public_token") or "",
            candidate_status_path=f"/c/{existing.get('public_token') or ''}",
            role_title=role_title,
            deduped=True,
        )

    public_token = _generate_public_token(name)

    # Insert the candidate row first so we can use its id as the dossier
    # path namespace (matches the convention in create_candidate and
    # parse_intake — keeps every artifact in /candidates/<id>/).
    candidate_payload: dict[str, Any] = {
        "name": name,
        "email": email_norm,
        "source": "site",
        "source_meta": {
            "linkedin_url": data.linkedin_url.strip() if data.linkedin_url else None,
            "portfolio_url": data.portfolio_url.strip() if data.portfolio_url else None,
            "why": (data.why or "").strip(),
            "submitted_at": datetime.now(timezone.utc).isoformat(),
        },
        "stage": "sourced",
        "status": "active",
        "public_token": public_token,
        "next_action": f"Review {name}'s public application — score and decide.",
    }
    if role_id:
        candidate_payload["role_id"] = role_id

    created = pod.table("candidates").create(candidate_payload)
    candidate_id = str(created["id"]) if isinstance(created, dict) else str(getattr(created, "id"))

    # Write the dossier file. We do this after the candidate insert so that
    # if the file write fails (transient storage error), we still have the
    # candidate row — the founder can re-trigger enrichment from the UI.
    dossier_md = _compose_dossier(
        data=data,
        role_title=role_title or "",
        public_token=public_token,
    )
    dossier_path = f"/candidates/{candidate_id}/dossier.md"
    try:
        pod.files.upload(dossier_path, dossier_md.encode("utf-8"))
        # Patch the candidate row with the dossier path now that the file
        # exists. Two-phase write — never reference a path we haven't
        # actually written.
        pod.table("candidates").update(candidate_id, {"dossier_path": dossier_path})
    except Exception:
        # Non-fatal — the row exists; the operator can enrich later.
        dossier_path = ""

    return SubmitApplicationResult(
        candidate_id=candidate_id,
        public_token=public_token,
        candidate_status_path=f"/c/{public_token}",
        role_title=role_title,
        deduped=False,
    )
