#input_type_name: ApplyDossierEnrichmentInput
#output_type_name: ApplyDossierEnrichmentResult
#function_name: apply_dossier_enrichment

"""
Persist the structured output of the `enrich_dossier` agent.

The agent reads the deterministic dossier + role context and returns a rewritten
dossier + refined score + refined next-action. This function applies all of that
to the pod: it overwrites the dossier file, updates the candidate row, and
appends a one-line audit note to the dossier footer so the founder can see why
the score moved.

Defensive on purpose — if the agent gave us a dossier that's clearly broken
(empty, too short, or missing the required section headings) we keep the
existing deterministic dossier and only update the score/next_action. We'd
rather degrade than corrupt the candidate's record.
"""

from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class ApplyDossierEnrichmentInput(BaseModel):
    candidate_id: str
    enriched_dossier_markdown: str = Field(
        description="The full rewritten dossier from the enrich_dossier agent."
    )
    refined_score: float = Field(ge=0, le=10)
    refined_next_action: str = Field(max_length=240)
    reasoning_note: str = Field(default="", max_length=2000)


class ApplyDossierEnrichmentResult(BaseModel):
    candidate_id: str
    dossier_path: str
    applied: bool
    score_before: Optional[float]
    score_after: float
    next_action_before: Optional[str]
    next_action_after: str
    note: str


# A "good" enriched dossier must have at least these section markers — if any
# are missing we treat the agent output as malformed and skip the dossier
# rewrite (we still apply the score/next_action update because those are simple
# scalars and easier to sanity-check).
_REQUIRED_SECTIONS = (
    "## Snapshot",
    "## Why interesting for this role",
    "## Concerns",
    "## Talking points",
    "## Prep questions",
    "## Confidence",
)


def _to_dict(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    if hasattr(value, "to_dict"):
        return value.to_dict() or {}
    if hasattr(value, "__dict__"):
        return dict(value.__dict__)
    return {}


def _dossier_is_well_formed(markdown: str) -> tuple[bool, str]:
    text = (markdown or "").strip()
    if len(text) < 200:
        return False, "enriched dossier is too short (<200 chars)"
    missing = [s for s in _REQUIRED_SECTIONS if s not in text]
    if missing:
        return False, f"enriched dossier missing sections: {', '.join(missing)}"
    return True, ""


def _audit_footer(*, score_before: Optional[float], score_after: float, reasoning: str) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    score_str = "—" if score_before is None else f"{score_before:.1f}"
    # Keep the audit footer short — reasoning_note from the agent is sometimes a
    # paragraph; clamp it here so it doesn't drown the dossier body. The
    # untruncated version is still passed back in the function's response.
    note = reasoning.strip() or "Enriched by AI."
    if len(note) > 320:
        note = note[:317].rstrip() + "…"
    return (
        "\n\n---\n\n"
        "_Enrichment audit_  \n"
        f"- Updated: {ts}  \n"
        f"- Score: {score_str} → {score_after:.1f}  \n"
        f"- Reasoning: {note}\n"
    )


async def apply_dossier_enrichment(
    ctx: FunctionContext, data: ApplyDossierEnrichmentInput
) -> ApplyDossierEnrichmentResult:
    pod = Pod.from_env()

    candidate = _to_dict(pod.records.get("candidates", data.candidate_id))
    if not candidate:
        return ApplyDossierEnrichmentResult(
            candidate_id=data.candidate_id,
            dossier_path="",
            applied=False,
            score_before=None,
            score_after=data.refined_score,
            next_action_before=None,
            next_action_after=data.refined_next_action,
            note="candidate not found — nothing applied",
        )

    score_before = candidate.get("score")
    score_before_float = float(score_before) if score_before is not None else None
    next_action_before = candidate.get("next_action")
    dossier_path = candidate.get("dossier_path") or f"/candidates/{data.candidate_id}/dossier.md"

    well_formed, problem = _dossier_is_well_formed(data.enriched_dossier_markdown)

    notes: list[str] = []
    wrote_file = False
    if well_formed:
        body = data.enriched_dossier_markdown.rstrip()
        footer = _audit_footer(
            score_before=score_before_float,
            score_after=data.refined_score,
            reasoning=data.reasoning_note,
        )
        pod.files.write_text(dossier_path, body + footer)
        wrote_file = True
        notes.append("dossier rewritten")
    else:
        notes.append(f"dossier rewrite SKIPPED ({problem}); score/next_action still applied")

    pod.table("candidates").update(data.candidate_id, {
        "score": data.refined_score,
        "next_action": data.refined_next_action,
        **({"dossier_path": dossier_path} if wrote_file else {}),
    })

    return ApplyDossierEnrichmentResult(
        candidate_id=data.candidate_id,
        dossier_path=dossier_path,
        applied=True,
        score_before=score_before_float,
        score_after=data.refined_score,
        next_action_before=next_action_before,
        next_action_after=data.refined_next_action,
        note="; ".join(notes),
    )
