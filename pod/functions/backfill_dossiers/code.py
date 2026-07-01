#input_type_name: BackfillDossiersInput
#output_type_name: BackfillDossiersResult
#function_name: backfill_dossiers

from datetime import datetime
from typing import Any, List

from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod


class BackfillDossiersInput(BaseModel):
    overwrite: bool = False  # if True, regenerate dossier_path even when one already exists


class BackfillDossiersResult(BaseModel):
    scanned: int
    written: int
    skipped: int
    paths: List[str]


def _items(response: Any) -> list[dict[str, Any]]:
    if hasattr(response, "to_dict"):
        return response.to_dict().get("items") or []
    if isinstance(response, dict):
        return response.get("items") or []
    return list(getattr(response, "items", []) or [])


def _stub_body(candidate: dict, role_title: str | None) -> str:
    name = candidate.get("name") or "Candidate"
    source = candidate.get("source") or "manual"
    score = candidate.get("score")
    score_str = f"{score:.1f}" if isinstance(score, (int, float)) else "—"
    role_line = f"- Considered for: {role_title}\n" if role_title else ""
    referrer = (candidate.get("source_meta") or {}).get("referrer_name") or None
    return (
        f"## Snapshot\n"
        f"- Source: {source}\n"
        f"{role_line}"
        f"- Referrer: {referrer or 'none'}\n"
        f"- Stage: {candidate.get('stage', 'sourced')}\n\n"
        f"## Why interesting for this role\n"
        f"_Auto-generated placeholder._ The intake agent didn't produce a structured dossier for this "
        f"candidate (likely a model timeout or rate-limit at the time of intake). Triage manually and "
        f"replace these bullets with real context after a quick LinkedIn pass.\n\n"
        f"## Concerns / things to watch\n"
        f"- Auto-dossier is a placeholder — verify role fit before reaching out.\n\n"
        f"## Talking points (3)\n"
        f"1. _Add a specific thing they shipped — not generic flattery._\n"
        f"2. _Add a recent technical decision or talk you've seen from them._\n"
        f"3. _Add why this role fits their trajectory._\n\n"
        f"## Prep questions (3)\n"
        f"1. _What was the last hard call you made on a product decision?_\n"
        f"2. _Tell me about the rough edge you're most proud of solving._\n"
        f"3. _What would you need from the founder in your first 90 days?_\n\n"
        f"## Confidence\n"
        f"Score {score_str} / 10 — placeholder dossier; rescore after manual triage."
    )


async def backfill_dossiers(ctx: FunctionContext, data: BackfillDossiersInput) -> BackfillDossiersResult:
    pod = Pod.from_env()

    candidates = _items(pod.records.list("candidates", limit=500))
    roles_by_id = {r["id"]: r.get("title") for r in _items(pod.records.list("roles", limit=100))}

    scanned = 0
    written = 0
    skipped = 0
    paths: list[str] = []

    for c in candidates:
        scanned += 1
        cid = c.get("id")
        if not cid:
            skipped += 1
            continue
        existing = c.get("dossier_path")
        if existing and not data.overwrite:
            skipped += 1
            continue

        dossier_path = f"/candidates/{cid}/dossier.md"
        role_title = roles_by_id.get(c.get("role_id"))
        header = (
            f"# {c.get('name', 'Candidate')}\n\n"
            f"*Sourced {datetime.utcnow().strftime('%Y-%m-%d')} · "
            f"{c.get('source', 'manual')}"
            f"{' · ' + role_title if role_title else ''}*\n\n"
            "---\n\n"
        )
        body = _stub_body(c, role_title)
        pod.files.write_text(dossier_path, header + body + "\n")
        pod.table("candidates").update(cid, {"dossier_path": dossier_path})
        written += 1
        paths.append(dossier_path)

    return BackfillDossiersResult(
        scanned=scanned,
        written=written,
        skipped=skipped,
        paths=paths,
    )
