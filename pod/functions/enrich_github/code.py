#input_type_name: EnrichGithubInput
#output_type_name: EnrichGithubResult
#function_name: enrich_github

"""
Enrich a candidate with GitHub signal.

Why this exists:
  For engineering roles, a candidate's GitHub is the most predictive
  artefact we have — more honest than a resume, more current than a
  LinkedIn. This function pulls the *public* signal (bio, follower count,
  top repos, primary languages) and appends a "GitHub signal" section to
  the candidate's dossier so the founder sees it on the same page as
  everything else, not in a separate tab.

Flow:
  1. Resolve the GitHub handle — either passed explicitly or derived from
     candidate.linkedin_url / candidate.email if they follow common patterns.
  2. `GITHUB_GET_USER_BY_ID`  → profile card (name, bio, followers, repos).
  3. `GITHUB_LIST_REPOSITORIES_FOR_A_USER` → top N public repos by
     recent activity, capped at 30.
  4. Compute language mix from repo primary-language field.
  5. Compose a markdown block and append to the dossier file at
     `/candidates/<id>/dossier.md`.
  6. Persist `candidate.github_username` and `candidate.github_score`
     (a simple 0-10 signal derived from followers + repos + activity).

Safety:
  - If the GitHub connector isn't wired, fail cleanly so the UI can
    surface "Connect GitHub" instead of half-updating the dossier.
  - Never overwrite an existing dossier — we always append under a fresh
    "## GitHub signal" heading, replacing only that section if it exists.
"""

import re
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class EnrichGithubInput(BaseModel):
    candidate_id: str
    github_username: Optional[str] = Field(
        default=None,
        description="Explicit GitHub handle. If omitted, we try to derive it from the candidate's linkedin_url or email prefix.",
    )
    max_repos: int = Field(default=10, ge=1, le=30)


class EnrichGithubResult(BaseModel):
    candidate_id: str
    github_username: str
    profile_url: str
    followers: int
    public_repos: int
    top_languages: list[str]
    top_repos: list[str]
    signal_score: float
    dossier_updated: bool
    mode: str  # "live" | "no_handle" | "connector_missing" | "failed"


GITHUB_AUTH_CONFIG = "github"


def _to_dict(obj: Any) -> dict:
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "to_dict"):
        return obj.to_dict()
    return getattr(obj, "__dict__", {}) or {}


def _has_github_auth(pod: Pod) -> bool:
    try:
        auth_configs = pod.connectors.auth_configs.list()
    except Exception:
        return False
    items = getattr(auth_configs, "items", None) or []
    return any(
        getattr(ac, "name", None) == GITHUB_AUTH_CONFIG
        for ac in items
    )


_GH_URL_RE = re.compile(r"github\.com/([A-Za-z0-9][A-Za-z0-9\-]{0,38})", re.IGNORECASE)


def _derive_handle(candidate: dict) -> Optional[str]:
    """Try to resolve a GitHub handle without asking the founder.

    Strategy:
      1. Explicit `github_username` column already set.
      2. `github_url` column pattern-matched.
      3. `linkedin_url` contact-links section rarely has GH; skip.
      4. Email local-part if it's clearly a handle-shaped username
         (letters + digits, no dots).  This is a hint, not a guarantee —
         we surface the derived handle in the result so the founder can
         correct it in the UI if wrong.
    """
    for key in ("github_username", "github_handle"):
        v = candidate.get(key)
        if v:
            return str(v).lstrip("@").strip()

    url = candidate.get("github_url") or ""
    m = _GH_URL_RE.search(url)
    if m:
        return m.group(1)

    email = candidate.get("email") or ""
    if "@" in email:
        local = email.split("@", 1)[0]
        if re.fullmatch(r"[A-Za-z][A-Za-z0-9\-]{2,38}", local):
            return local
    return None


def _extract_composio_data(result: Any) -> dict:
    envelope = _to_dict(getattr(result, "result", None) or getattr(result, "data", None) or result)
    if not envelope:
        envelope = _to_dict(result)
    if envelope.get("successful") is False or envelope.get("error"):
        raise RuntimeError(f"GitHub API call failed: {envelope.get('error') or 'unknown'}")
    data = envelope.get("data")
    return data if isinstance(data, dict) else envelope


def _extract_composio_list(result: Any) -> list[dict]:
    envelope = _to_dict(getattr(result, "result", None) or getattr(result, "data", None) or result)
    if not envelope:
        envelope = _to_dict(result)
    if envelope.get("successful") is False or envelope.get("error"):
        raise RuntimeError(f"GitHub API call failed: {envelope.get('error') or 'unknown'}")
    data = envelope.get("data")
    if isinstance(data, list):
        return [d for d in data if isinstance(d, dict)]
    if isinstance(data, dict):
        for k in ("items", "repositories", "results"):
            v = data.get(k)
            if isinstance(v, list):
                return [d for d in v if isinstance(d, dict)]
    return []


def _score(followers: int, public_repos: int, repo_stars_total: int, last_push: Optional[datetime]) -> float:
    """0–10 heuristic. Not scientific — just fast triage signal for the
    founder to see next to the dossier."""
    from math import log10
    followers_pts = min(3.0, log10(max(followers, 1)) * 1.2)
    repos_pts = min(2.5, log10(max(public_repos, 1)) * 1.8)
    stars_pts = min(3.0, log10(max(repo_stars_total, 1)) * 1.3)
    freshness_pts = 0.0
    if last_push:
        days = (datetime.now(timezone.utc) - last_push).days
        if days < 30:
            freshness_pts = 1.5
        elif days < 180:
            freshness_pts = 1.0
        elif days < 730:
            freshness_pts = 0.5
    return round(min(10.0, followers_pts + repos_pts + stars_pts + freshness_pts), 1)


def _compose_dossier_section(
    *,
    handle: str,
    profile_url: str,
    bio: str,
    followers: int,
    following: int,
    public_repos: int,
    top_languages: list[tuple[str, int]],
    top_repos: list[dict],
    signal_score: float,
) -> str:
    lines = ["## GitHub signal", ""]
    lines.append(f"- Handle: [`@{handle}`]({profile_url})")
    if bio:
        lines.append(f"- Bio: {bio.strip()}")
    lines.append(f"- Followers: {followers} · Following: {following} · Public repos: {public_repos}")
    lines.append(f"- Signal score (0–10): **{signal_score}**")
    if top_languages:
        langs = ", ".join(f"{name} ({cnt})" for name, cnt in top_languages[:5])
        lines.append(f"- Top languages: {langs}")
    if top_repos:
        lines.append("")
        lines.append("### Recent repos")
        for r in top_repos[:10]:
            name = r.get("name") or r.get("full_name") or ""
            url = r.get("html_url") or r.get("url") or ""
            stars = r.get("stargazers_count") or r.get("stars") or 0
            desc = (r.get("description") or "").strip()
            lang = r.get("language") or ""
            bits = [f"[{name}]({url})" if url else name, f"★ {stars}"]
            if lang:
                bits.append(lang)
            head = " · ".join(bits)
            if desc:
                lines.append(f"- {head} — {desc}")
            else:
                lines.append(f"- {head}")
    lines.append("")
    lines.append(f"_Auto-enriched via GitHub connector at {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}._")
    return "\n".join(lines)


_SECTION_HEADER_RE = re.compile(r"^##\s+GitHub signal\s*$", re.MULTILINE)


def _merge_into_dossier(existing: str, new_section: str) -> str:
    """Replace the existing GitHub-signal block (if any), else append."""
    if not existing.strip():
        return new_section.strip() + "\n"
    m = _SECTION_HEADER_RE.search(existing)
    if not m:
        sep = "" if existing.endswith("\n") else "\n"
        return existing + sep + "\n" + new_section.strip() + "\n"
    start = m.start()
    # Find the next h2 heading after ours; if none, replace to EOF.
    rest = existing[m.end():]
    next_h2 = re.search(r"^##\s+", rest, re.MULTILINE)
    end = m.end() + next_h2.start() if next_h2 else len(existing)
    return existing[:start] + new_section.strip() + "\n\n" + existing[end:]


async def enrich_github(ctx: FunctionContext, data: EnrichGithubInput) -> EnrichGithubResult:
    pod = Pod.from_env()

    candidate = _to_dict(pod.records.get("candidates", data.candidate_id))
    if not candidate:
        raise ValueError(f"Candidate {data.candidate_id} not found.")

    handle = data.github_username or _derive_handle(candidate)
    if not handle:
        return EnrichGithubResult(
            candidate_id=data.candidate_id,
            github_username="",
            profile_url="",
            followers=0,
            public_repos=0,
            top_languages=[],
            top_repos=[],
            signal_score=0.0,
            dossier_updated=False,
            mode="no_handle",
        )

    if not _has_github_auth(pod):
        raise RuntimeError(
            f"No '{GITHUB_AUTH_CONFIG}' auth config wired for the GitHub connector. "
            "Connect GitHub in the integrations panel and retry."
        )

    try:
        profile_raw = pod.connectors.execute(
            GITHUB_AUTH_CONFIG,
            "GITHUB_GET_USER_BY_ID",
            {"username": handle},
        )
        profile = _extract_composio_data(profile_raw)
    except Exception as exc:
        raise RuntimeError(f"GitHub profile fetch failed for '{handle}': {exc!s}")

    try:
        repos_raw = pod.connectors.execute(
            GITHUB_AUTH_CONFIG,
            "GITHUB_LIST_REPOSITORIES_FOR_A_USER",
            {"username": handle, "per_page": data.max_repos, "sort": "pushed", "direction": "desc"},
        )
        repos = _extract_composio_list(repos_raw)
    except Exception:
        repos = []

    followers = int(profile.get("followers") or 0)
    following = int(profile.get("following") or 0)
    public_repos = int(profile.get("public_repos") or 0)
    bio = str(profile.get("bio") or "")
    profile_url = str(profile.get("html_url") or f"https://github.com/{handle}")
    name_from_gh = str(profile.get("name") or "")

    lang_count: dict[str, int] = {}
    stars_total = 0
    latest_push: Optional[datetime] = None
    for r in repos:
        lang = (r.get("language") or "").strip()
        if lang:
            lang_count[lang] = lang_count.get(lang, 0) + 1
        stars_total += int(r.get("stargazers_count") or r.get("stars") or 0)
        pushed = r.get("pushed_at") or r.get("updated_at")
        if pushed:
            try:
                dt = datetime.fromisoformat(str(pushed).replace("Z", "+00:00"))
                if latest_push is None or dt > latest_push:
                    latest_push = dt
            except Exception:
                pass

    top_languages_ranked = sorted(lang_count.items(), key=lambda kv: -kv[1])
    signal_score = _score(followers, public_repos, stars_total, latest_push)

    section = _compose_dossier_section(
        handle=handle,
        profile_url=profile_url,
        bio=bio,
        followers=followers,
        following=following,
        public_repos=public_repos,
        top_languages=top_languages_ranked,
        top_repos=repos,
        signal_score=signal_score,
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

    # Persist the resolved handle + score so downstream reads don't
    # need to redo detection.
    try:
        update: dict[str, Any] = {"github_username": handle, "github_score": signal_score}
        if name_from_gh and not candidate.get("name"):
            update["name"] = name_from_gh
        pod.records.update("candidates", data.candidate_id, update)
    except Exception:
        pass

    return EnrichGithubResult(
        candidate_id=data.candidate_id,
        github_username=handle,
        profile_url=profile_url,
        followers=followers,
        public_repos=public_repos,
        top_languages=[l for l, _ in top_languages_ranked[:5]],
        top_repos=[str(r.get("html_url") or r.get("name") or "") for r in repos[:5]],
        signal_score=signal_score,
        dossier_updated=dossier_updated,
        mode="live",
    )
