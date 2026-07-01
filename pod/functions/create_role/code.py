#input_type_name: CreateRoleInput
#output_type_name: CreateRoleResult
#function_name: create_role

"""
Atomically create a role: roles row + pitch.md + rubric.md.

Roles drive scoring everywhere in the pod — the deterministic intake parser
keyword-matches against must_haves/nice_haves, the dossier enricher reads the
rubric, and the outreach drafter reads the pitch. So creating a role is a
3-step thing (row, pitch file, rubric file) that the operator UI shouldn't
have to orchestrate by hand. This function is the one entry point.

Slug handling: title-derived, lowercased, dash-joined. If the generated slug
collides with an existing role we append -2, -3, etc. so the UI can keep
calling create_role with the same title without exploding.

If the caller passes empty pitch/rubric strings we still write minimal
placeholder files — empty file paths break dossier rendering downstream,
and a stub is easier to edit than to debug.
"""

import re
from typing import Any, Optional

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class CreateRoleInput(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    slug: Optional[str] = Field(
        default=None,
        max_length=80,
        description="Override the auto-generated slug. Lowercased + dash-joined automatically.",
    )
    status: str = Field(default="open", pattern=r"^(open|paused|filled|closed)$")
    must_haves: list[str] = Field(default_factory=list)
    nice_haves: list[str] = Field(default_factory=list)
    pitch: str = Field(default="", description="Markdown body for /knowledge/roles/<slug>/pitch.md")
    rubric: str = Field(default="", description="Markdown body for /knowledge/roles/<slug>/rubric.md")


class CreateRoleResult(BaseModel):
    role_id: str
    slug: str
    title: str
    status: str
    rubric_file: str
    pitch_file: str


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(value: str) -> str:
    slug = _SLUG_RE.sub("-", value.lower()).strip("-")
    return slug[:60] or "role"


def _items(response: Any) -> list[dict[str, Any]]:
    if hasattr(response, "to_dict"):
        return response.to_dict().get("items") or []
    if isinstance(response, dict):
        return response.get("items") or []
    return list(getattr(response, "items", []) or [])


def _unique_slug(pod: Pod, base: str) -> str:
    """Pick a slug that doesn't already exist on roles. Tries base, then
    base-2, base-3, ... up to base-99. Anything beyond that is a developer
    error and we just append a 4-digit hash."""
    candidate = base
    for i in range(1, 100):
        existing = _items(
            pod.records.list(
                "roles",
                limit=1,
                filter=[{"field": "slug", "op": "eq", "value": candidate}],
            )
        )
        if not existing:
            return candidate
        candidate = f"{base}-{i + 1}"
    import secrets
    return f"{base}-{secrets.token_hex(2)}"


def _default_pitch(title: str) -> str:
    return (
        f"# {title}\n\n"
        f"What this role *actually* does (versus what the title suggests).\n\n"
        "## The work\n\n"
        "- (Replace these bullets with the real shape of the job.)\n\n"
        "## What you'd own in the first 90 days\n\n"
        "- (One concrete thing.)\n"
        "- (Another concrete thing.)\n"
        "- (A third concrete thing.)\n\n"
        "## Who this is for\n\n"
        "Edit this section before sending it to a candidate. The outreach drafter "
        "reads it verbatim — vague pitch in, vague email out.\n"
    )


def _default_rubric(title: str, must_haves: list[str], nice_haves: list[str]) -> str:
    must = "\n".join(f"- {m}" for m in must_haves) or "- (Add at least 3 hard requirements.)"
    nice = "\n".join(f"- {n}" for n in nice_haves) or "- (Add anything that would tip a borderline candidate to a yes.)"
    return (
        f"# {title} — Rubric\n\n"
        "How the dossier enricher decides whether to score someone high or low for this role. "
        "Be specific — the LLM is good at matching language but it can't read your mind.\n\n"
        "## Must-haves\n\n"
        f"{must}\n\n"
        "## Nice-to-haves\n\n"
        f"{nice}\n\n"
        "## Red flags\n\n"
        "- (e.g. \"No public shipped work in 3+ years\" or \"Only worked at companies > 500 people\".)\n\n"
        "## Scoring guide\n\n"
        "- **9–10**: Every must-have demonstrated with specifics, multiple nice-to-haves, zero red flags.\n"
        "- **7–8**: All must-haves credibly present, some nice-to-haves.\n"
        "- **5–6**: Most must-haves; gaps explained or recoverable.\n"
        "- **3–4**: One or more must-haves missing or unclear from public signal.\n"
        "- **1–2**: A red flag triggered, or fundamentally a different shape of person.\n"
    )


async def create_role(ctx: FunctionContext, data: CreateRoleInput) -> CreateRoleResult:
    pod = Pod.from_env()

    base_slug = _slugify(data.slug or data.title)
    slug = _unique_slug(pod, base_slug)

    rubric_path = f"/knowledge/roles/{slug}/rubric.md"
    pitch_path = f"/knowledge/roles/{slug}/pitch.md"

    pitch_body = (data.pitch or "").strip() or _default_pitch(data.title)
    rubric_body = (data.rubric or "").strip() or _default_rubric(
        data.title, data.must_haves, data.nice_haves
    )

    pod.files.write_text(pitch_path, pitch_body + "\n")
    pod.files.write_text(rubric_path, rubric_body + "\n")

    record = pod.table("roles").create({
        "title": data.title.strip(),
        "slug": slug,
        "status": data.status,
        "must_haves": [m.strip() for m in data.must_haves if m and m.strip()],
        "nice_haves": [n.strip() for n in data.nice_haves if n and n.strip()],
        "rubric_file": rubric_path,
        "pitch_file": pitch_path,
    })

    return CreateRoleResult(
        role_id=str(record["id"]),
        slug=slug,
        title=data.title.strip(),
        status=data.status,
        rubric_file=rubric_path,
        pitch_file=pitch_path,
    )
