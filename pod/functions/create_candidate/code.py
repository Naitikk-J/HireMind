#input_type_name: CreateCandidateInput
#output_type_name: CreateCandidateResult
#function_name: create_candidate

import re
import secrets
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class CreateCandidateInput(BaseModel):
    name: str
    email: Optional[str] = None
    linkedin_url: Optional[str] = None
    source: str = Field(default="manual", description="linkedin | referral | inbound_email | twitter | site | manual")
    role_slug: Optional[str] = Field(default=None, description="roles.slug — looked up to resolve role_id")
    referrer_name: Optional[str] = None
    score: Optional[float] = None
    next_action: Optional[str] = None
    dossier_markdown: Optional[str] = Field(default=None, description="Full dossier body (already authored by an upstream agent).")


class CreateCandidateResult(BaseModel):
    candidate_id: str
    candidate_number: int
    dossier_path: str
    public_token: str


_TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:40] or "candidate"


def _generate_public_token(name: str) -> str:
    suffix = "".join(secrets.choice(_TOKEN_ALPHABET) for _ in range(6))
    return f"{_slugify(name)}-{suffix}"


def _list_items(response: Any) -> list[dict[str, Any]]:
    """Pull the items list out of a RecordListResponse regardless of whether it's
    a Pydantic model (.to_dict()) or already a dict."""
    if hasattr(response, "to_dict"):
        return response.to_dict().get("items") or []
    if isinstance(response, dict):
        return response.get("items") or []
    return list(getattr(response, "items", []) or [])


async def create_candidate(ctx: FunctionContext, data: CreateCandidateInput) -> CreateCandidateResult:
    pod = Pod.from_env()

    role_id = None
    if data.role_slug:
        roles_resp = pod.records.list(
            "roles",
            limit=1,
            filter=[{"field": "slug", "op": "eq", "value": data.role_slug}],
        )
        roles_items = _list_items(roles_resp)
        if roles_items:
            role_id = roles_items[0]["id"]

    referrer_id = None
    if data.referrer_name:
        ref_resp = pod.records.list(
            "referrers",
            limit=1,
            filter=[{"field": "name", "op": "eq", "value": data.referrer_name}],
        )
        ref_items = _list_items(ref_resp)
        if ref_items:
            referrer_id = ref_items[0]["id"]
        else:
            new_ref = pod.table("referrers").create({
                "name": data.referrer_name,
                "preferred_channel": "whatsapp",
                "auto_update_approved": False,
            })
            referrer_id = new_ref["id"]

    public_token = _generate_public_token(data.name)

    record = pod.table("candidates").create({
        "name": data.name,
        "email": data.email,
        "linkedin_url": data.linkedin_url,
        "source": data.source,
        "source_meta": {"referrer_name": data.referrer_name} if data.referrer_name else {},
        "role_id": role_id,
        "referrer_id": referrer_id,
        "stage": "sourced",
        "status": "active",
        "score": data.score,
        "next_action": data.next_action or "Review dossier and draft intro",
        "public_token": public_token,
        "owner_user_id": str(ctx.user_id),
    })

    candidate_id = str(record["id"])
    dossier_path = f"/candidates/{candidate_id}/dossier.md"

    header = (
        f"# {data.name}\n\n"
        f"*Sourced {datetime.utcnow().strftime('%Y-%m-%d')} · "
        f"{data.source}{' · referred by ' + data.referrer_name if data.referrer_name else ''}*\n\n"
        "---\n\n"
    )
    body = (data.dossier_markdown or "").strip()
    if not body:
        # Fallback: agent skipped the dossier — produce a minimal stub so the
        # candidate page isn't empty and the founder knows to triage.
        body = (
            "## Snapshot\n"
            f"- Source: {data.source}\n"
            f"- Referrer: {data.referrer_name or 'none'}\n\n"
            "## Why interesting for this role\n"
            "Dossier was not generated automatically — agent run did not return prose. "
            "Triage manually and add notes here.\n\n"
            "## Concerns / things to watch\n"
            "- Auto-generated dossier failed; review intake source before reaching out.\n\n"
            "## Talking points (3)\n"
            "1. _Add after a quick LinkedIn skim._\n"
            "2. _Add after a quick LinkedIn skim._\n"
            "3. _Add after a quick LinkedIn skim._\n\n"
            "## Prep questions (3)\n"
            "1. _Add after a quick LinkedIn skim._\n"
            "2. _Add after a quick LinkedIn skim._\n"
            "3. _Add after a quick LinkedIn skim._\n\n"
            "## Confidence\n"
            f"Score {data.score or 0} / 10 — placeholder dossier."
        )
    pod.files.write_text(dossier_path, header + body + "\n")

    pod.table("candidates").update(candidate_id, {"dossier_path": dossier_path})

    return CreateCandidateResult(
        candidate_id=candidate_id,
        candidate_number=int(record["number"]),
        dossier_path=dossier_path,
        public_token=public_token,
    )
