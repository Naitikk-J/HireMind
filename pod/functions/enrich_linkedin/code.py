#input_type_name: EnrichLinkedInInput
#output_type_name: EnrichLinkedInResult
#function_name: enrich_linkedin

"""
Enrich a candidate with LinkedIn signal.

parse_intake already stores a `linkedin_url`, but that's just the pointer;
this function actually calls the LinkedIn connector and pulls the person's
current-role + positions + education + follower count into a dossier
section the founder can read at a glance.

Composio's `LINKEDIN_GET_PERSON` accepts a `person_id` or a `public_id`
(the URL-slug at the end of a profile). We use whichever we can extract.

Idempotent: replaces the existing '## LinkedIn signal' section if present.
"""

import re
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class EnrichLinkedInInput(BaseModel):
    candidate_id: str
    public_id: Optional[str] = Field(
        default=None,
        description="LinkedIn public id (the URL slug — e.g. 'priya-mehta-ai' from linkedin.com/in/priya-mehta-ai). If omitted, we derive it from candidate.linkedin_url.",
    )


class EnrichLinkedInResult(BaseModel):
    candidate_id: str
    public_id: str
    headline: str
    current_role: str
    current_company: str
    positions_count: int
    connections: int
    dossier_updated: bool
    mode: str  # "live" | "no_id" | "connector_missing" | "failed"


LINKEDIN_AUTH_CONFIG = "linkedin"

_LI_SLUG_RE = re.compile(r"linkedin\.com/(?:in|pub)/([A-Za-z0-9\-\_%]+)", re.IGNORECASE)


def _to_dict(obj: Any) -> dict:
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "to_dict"):
        return obj.to_dict()
    return getattr(obj, "__dict__", {}) or {}


def _has_linkedin_auth(pod: Pod) -> bool:
    try:
        auth_configs = pod.connectors.auth_configs.list()
    except Exception:
        return False
    items = getattr(auth_configs, "items", None) or []
    return any(getattr(ac, "name", None) == LINKEDIN_AUTH_CONFIG for ac in items)


def _derive_public_id(candidate: dict) -> Optional[str]:
    url = candidate.get("linkedin_url") or candidate.get("linkedinUrl") or ""
    m = _LI_SLUG_RE.search(url)
    if m:
        return m.group(1).rstrip("/")
    return None


def _extract_composio_data(result: Any) -> dict:
    envelope = _to_dict(getattr(result, "result", None) or getattr(result, "data", None) or result)
    if not envelope:
        envelope = _to_dict(result)
    if envelope.get("successful") is False or envelope.get("error"):
        raise RuntimeError(f"LinkedIn API call failed: {envelope.get('error') or 'unknown'}")
    data = envelope.get("data")
    return data if isinstance(data, dict) else envelope


def _current_position(positions: list[dict]) -> dict:
    for p in positions:
        if not isinstance(p, dict):
            continue
        end = p.get("end_date") or p.get("endDate") or p.get("date_range", {})
        # Composio surfaces "current" as either end_date=null or a flag.
        if not end or (isinstance(end, dict) and not end.get("end")):
            return p
    return positions[0] if positions else {}


def _compose_dossier_section(
    *,
    public_id: str,
    profile_url: str,
    full_name: str,
    headline: str,
    location: str,
    current_role: str,
    current_company: str,
    positions: list[dict],
    education: list[dict],
    connections: int,
    followers: int,
) -> str:
    lines = ["## LinkedIn signal", ""]
    lines.append(f"- Profile: [`{public_id}`]({profile_url})")
    if full_name:
        lines.append(f"- Name (from LinkedIn): {full_name}")
    if headline:
        lines.append(f"- Headline: {headline}")
    if location:
        lines.append(f"- Location: {location}")
    if current_role or current_company:
        line = "- Currently: "
        if current_role:
            line += current_role
        if current_company:
            line += f" @ {current_company}" if current_role else current_company
        lines.append(line)
    if connections or followers:
        bits = []
        if connections:
            bits.append(f"{connections} connections")
        if followers:
            bits.append(f"{followers} followers")
        lines.append(f"- Reach: {' · '.join(bits)}")
    if positions:
        lines.append("")
        lines.append("### Recent positions")
        for p in positions[:6]:
            title = str(p.get("title") or p.get("position") or "").strip()
            company = str(
                (p.get("company") or {}).get("name") if isinstance(p.get("company"), dict) else (p.get("company_name") or p.get("company") or "")
            ).strip()
            dates = ""
            dr = p.get("date_range") or {}
            if isinstance(dr, dict):
                s = dr.get("start") or {}
                e = dr.get("end") or {}
                if isinstance(s, dict) and s.get("year"):
                    dates = f"{s.get('year')}"
                    if isinstance(e, dict) and e.get("year"):
                        dates += f"—{e.get('year')}"
                    elif not e:
                        dates += "—present"
            head_bits = [b for b in [title, company, dates] if b]
            if head_bits:
                lines.append(f"- {' · '.join(head_bits)}")
    if education:
        lines.append("")
        lines.append("### Education")
        for edu in education[:3]:
            school = str((edu.get("school") or {}).get("name") if isinstance(edu.get("school"), dict) else (edu.get("school_name") or edu.get("school") or "")).strip()
            degree = str(edu.get("degree") or edu.get("degree_name") or "").strip()
            field = str(edu.get("field_of_study") or "").strip()
            bits = [b for b in [school, degree, field] if b]
            if bits:
                lines.append(f"- {' · '.join(bits)}")
    lines.append("")
    lines.append(f"_Auto-enriched via LinkedIn connector at {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}._")
    return "\n".join(lines)


_SECTION_HEADER_RE = re.compile(r"^##\s+LinkedIn signal\s*$", re.MULTILINE)


def _merge_into_dossier(existing: str, new_section: str) -> str:
    if not existing.strip():
        return new_section.strip() + "\n"
    m = _SECTION_HEADER_RE.search(existing)
    if not m:
        sep = "" if existing.endswith("\n") else "\n"
        return existing + sep + "\n" + new_section.strip() + "\n"
    start = m.start()
    rest = existing[m.end():]
    next_h2 = re.search(r"^##\s+", rest, re.MULTILINE)
    end = m.end() + next_h2.start() if next_h2 else len(existing)
    return existing[:start] + new_section.strip() + "\n\n" + existing[end:]


async def enrich_linkedin(ctx: FunctionContext, data: EnrichLinkedInInput) -> EnrichLinkedInResult:
    pod = Pod.from_env()

    candidate = _to_dict(pod.records.get("candidates", data.candidate_id))
    if not candidate:
        raise ValueError(f"Candidate {data.candidate_id} not found.")

    public_id = data.public_id or _derive_public_id(candidate)
    if not public_id:
        return EnrichLinkedInResult(
            candidate_id=data.candidate_id,
            public_id="",
            headline="",
            current_role="",
            current_company="",
            positions_count=0,
            connections=0,
            dossier_updated=False,
            mode="no_id",
        )

    if not _has_linkedin_auth(pod):
        raise RuntimeError(
            f"No '{LINKEDIN_AUTH_CONFIG}' auth config wired for the LinkedIn connector. "
            "Connect LinkedIn in the integrations panel and retry."
        )

    try:
        raw = pod.connectors.execute(
            LINKEDIN_AUTH_CONFIG,
            "LINKEDIN_GET_PERSON",
            {"public_id": public_id},
        )
        profile = _extract_composio_data(raw)
    except Exception as exc:
        raise RuntimeError(f"LinkedIn profile fetch failed for '{public_id}': {exc!s}")

    full_name = str(profile.get("full_name") or profile.get("name") or "").strip()
    headline = str(profile.get("headline") or "").strip()
    location_field = profile.get("location") or {}
    if isinstance(location_field, dict):
        location = str(location_field.get("name") or location_field.get("full") or "").strip()
    else:
        location = str(location_field or "").strip()
    connections = int(profile.get("connections") or profile.get("connection_count") or 0)
    followers = int(profile.get("followers") or profile.get("follower_count") or 0)
    positions_raw = profile.get("positions") or profile.get("experience") or []
    if not isinstance(positions_raw, list):
        positions_raw = []
    positions: list[dict] = [p for p in positions_raw if isinstance(p, dict)]
    education_raw = profile.get("education") or []
    education: list[dict] = [e for e in education_raw if isinstance(e, dict)]

    cur = _current_position(positions)
    current_role = str(cur.get("title") or cur.get("position") or "").strip()
    current_company = ""
    if isinstance(cur.get("company"), dict):
        current_company = str(cur["company"].get("name") or "").strip()
    if not current_company:
        current_company = str(cur.get("company_name") or cur.get("company") or "").strip()

    profile_url = str(profile.get("url") or f"https://www.linkedin.com/in/{public_id}")

    section = _compose_dossier_section(
        public_id=public_id,
        profile_url=profile_url,
        full_name=full_name,
        headline=headline,
        location=location,
        current_role=current_role,
        current_company=current_company,
        positions=positions,
        education=education,
        connections=connections,
        followers=followers,
    )

    dossier_path = candidate.get("dossier_path") or f"/candidates/{data.candidate_id}/dossier.md"
    existing = ""
    try:
        blob = pod.files.download(dossier_path)
        existing = blob.decode("utf-8", errors="replace") if blob else ""
    except Exception:
        existing = ""
    merged = _merge_into_dossier(existing, section)
    dossier_updated = False
    try:
        pod.files.upload(dossier_path, merged.encode("utf-8"))
        dossier_updated = True
    except Exception:
        dossier_updated = False

    try:
        update: dict[str, Any] = {}
        if full_name and not candidate.get("name"):
            update["name"] = full_name
        if headline:
            update["linkedin_headline"] = headline
        if current_role:
            update["linkedin_current_role"] = current_role
        if current_company:
            update["linkedin_current_company"] = current_company
        if update:
            pod.records.update("candidates", data.candidate_id, update)
    except Exception:
        pass

    return EnrichLinkedInResult(
        candidate_id=data.candidate_id,
        public_id=public_id,
        headline=headline,
        current_role=current_role,
        current_company=current_company,
        positions_count=len(positions),
        connections=connections,
        dossier_updated=dossier_updated,
        mode="live",
    )
