#input_type_name: PipeToIntakeInput
#output_type_name: PipeToIntakeResult
#function_name: pipe_to_intake

"""
Thin pipe from any chat surface into the intake pipeline.

Why this exists (and why it's not three function calls anymore)
---------------------------------------------------------------
Earlier versions of this function called `parse_intake` and
`create_candidate` via `pod.functions.run`, but every inner call spins
up its own sandboxed runtime (~15s cold start each). With three calls
chained synchronously, we routinely blew past the 120s API-function
ceiling and the 30s SDK transport timeout. The LLM agent on the
Telegram surface (which has no `run_workflow` tool in the POD toolset)
needs ONE fast tool call and a clear success/fail.

So we inline both pieces here:
  1) the deterministic parse logic (LinkedIn / email / name regexes
     plus keyword-overlap role scoring), and
  2) the candidate + dossier write,
…in a single function runtime. `triage_and_notify` (the founder-email
step) is **not** invoked here — it depends on Gmail which can stall
for 10-30s and isn't worth blocking the chat surface on. The kanban
row + dossier are the primary signal; the email is a future
enhancement.

The inline parse/create logic mirrors `parse_intake/code.py` and
`create_candidate/code.py` as of writing. If those evolve, copy the
relevant changes here — pragmatic duplication beats unreliable
function-from-function chaining on the current platform.
"""

import re
import secrets
from datetime import datetime
from typing import Any, List, Optional, Tuple

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


# ---------------------------------------------------------------------------
# Input / output schemas
# ---------------------------------------------------------------------------

_VALID_CHANNEL_HINTS = {
    "linkedin", "referral", "inbound_email", "twitter", "site", "manual",
}


class PipeToIntakeInput(BaseModel):
    raw: str = Field(
        ...,
        description=(
            "Full inbound message — LinkedIn URL, pasted resume, free-text "
            "description, or any concatenation thereof. Sent verbatim to the "
            "inline parser; do not summarize upstream."
        ),
        min_length=1,
    )
    channel_hint: str = Field(
        default="manual",
        description=(
            "Where the intake came from. Defaults to 'manual' (Telegram / "
            "WhatsApp / personal-feed flows). Must be one of "
            f"{sorted(_VALID_CHANNEL_HINTS)}."
        ),
    )
    role_slug: Optional[str] = Field(
        default=None,
        description=(
            "Optional roles.slug. When set, scores against this specific role "
            "instead of auto-matching. Chat surfaces should leave this null."
        ),
    )


class PipeToIntakeResult(BaseModel):
    candidate_id: str = Field(description="The newly-created candidate's id.")
    candidate_number: int = Field(description="Sequential candidate number.")
    name: str = Field(description="Parsed candidate display name.")
    score: float = Field(description="Role-fit score 0..10 (deterministic).")
    role_slug: Optional[str] = Field(
        default=None,
        description="Slug of the best-matched open role, if any.",
    )
    dossier_path: str = Field(description="Pod file path to the dossier markdown.")
    public_token: str = Field(description="Public-link token for the candidate.")


# ---------------------------------------------------------------------------
# Extraction helpers (inlined from parse_intake)
# ---------------------------------------------------------------------------

_LINKEDIN_RE = re.compile(
    r"https?://(?:www\.)?linkedin\.com/in/([\w\-\.%]+)(?:/[^\s]*)?",
    re.IGNORECASE,
)
_LINKEDIN_BARE_RE = re.compile(
    r"(?<![\w/])linkedin\.com/in/([\w\-\.%]+)",
    re.IGNORECASE,
)
_TWITTER_RE = re.compile(
    r"(?:https?://)?(?:www\.)?(?:twitter|x)\.com/(\w+)",
    re.IGNORECASE,
)
_EMAIL_RE = re.compile(r"\b[\w._%+\-]+@[\w.\-]+\.[a-zA-Z]{2,}\b")
_REFERRAL_PATTERNS = [
    re.compile(r"\b(?:referred(?:\s+to\s+(?:me|us))?\s+by|intro(?:duced)?\s+by|via)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b"),
    re.compile(r"\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:referred|introduced|told\s+me\s+about|recommended)\b"),
    re.compile(r"\bfrom\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s*\.?\s*(?:she|he|they)", re.IGNORECASE),
]

_NAME_BLOCKLIST = {"the", "a", "an", "and", "at", "in", "on", "for", "with", "from", "to", "of"}
_NAME_PREFIX_BLOCKLIST = {"hey", "hi", "hello", "yo", "quick", "got", "found", "saw", "spoke"}


def _extract_linkedin(raw: str) -> Optional[str]:
    m = _LINKEDIN_RE.search(raw)
    if m:
        return f"https://linkedin.com/in/{m.group(1).rstrip('/').rstrip('.')}"
    m = _LINKEDIN_BARE_RE.search(raw)
    if m:
        return f"https://linkedin.com/in/{m.group(1).rstrip('/').rstrip('.')}"
    return None


def _name_from_linkedin_slug(slug: str) -> str:
    raw = slug.split("?")[0].split("/")[0]
    raw = re.sub(r"-[a-f0-9]{6,}$", "", raw)
    parts = [p for p in re.split(r"[-._]+", raw) if p and not p.isdigit()]
    return " ".join(p.capitalize() for p in parts) if parts else "Candidate"


def _extract_name(raw: str, linkedin_url: Optional[str]) -> str:
    head = raw[:240].replace("—", " ").replace("–", " ")
    sentences = re.split(r"[\n.,;:!?]", head)

    for chunk in sentences:
        chunk = chunk.strip()
        if not chunk:
            continue
        m = re.search(r"\b([A-Z][a-z]{1,15})\s+([A-Z][a-z]{1,20})\b", chunk)
        if m:
            first, last = m.group(1), m.group(2)
            if first.lower() in _NAME_PREFIX_BLOCKLIST or last.lower() in _NAME_BLOCKLIST:
                continue
            return f"{first} {last}"

    for chunk in sentences:
        chunk = chunk.strip()
        if not chunk:
            continue
        m = re.search(
            r"\b(?:saw|met|spoke|spotted|found|got|hey|hi|hello|quick\s+note|note|chat\s+with|talked\s+to|intro\s+with)\s+([A-Z][a-z]{2,20})\b",
            chunk, re.IGNORECASE,
        )
        if m:
            return m.group(1)

    if linkedin_url:
        slug = linkedin_url.rstrip("/").rsplit("/", 1)[-1]
        derived = _name_from_linkedin_slug(slug)
        if derived and derived != "Candidate":
            return derived

    m = re.match(r"\s*([A-Z][a-z]{2,20})\b", raw)
    if m and m.group(1).lower() not in _NAME_PREFIX_BLOCKLIST:
        return m.group(1)

    first_line = next((ln.strip() for ln in raw.splitlines() if ln.strip()), "")
    if first_line and len(first_line) < 80:
        first_line = re.sub(r"^(?:re|fw|fwd):\s*", "", first_line, flags=re.IGNORECASE)
        if first_line:
            return first_line.split(",")[0].split(" - ")[0].strip()[:60] or "Candidate"
    return "Candidate"


def _extract_referrer(raw: str) -> Optional[str]:
    for pattern in _REFERRAL_PATTERNS:
        m = pattern.search(raw)
        if not m:
            continue
        name = m.group(1).strip()
        if name.lower() in _NAME_PREFIX_BLOCKLIST:
            continue
        return name
    return None


def _detect_source(raw: str, linkedin_url: Optional[str], referrer: Optional[str], channel_hint: str) -> str:
    if linkedin_url:
        return "linkedin"
    if referrer:
        return "referral"
    if _TWITTER_RE.search(raw):
        return "twitter"
    if _EMAIL_RE.search(raw) and channel_hint == "manual":
        return "inbound_email"
    if channel_hint in _VALID_CHANNEL_HINTS:
        return channel_hint
    return "manual"


# ---------------------------------------------------------------------------
# Role matching (inlined)
# ---------------------------------------------------------------------------

_STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "if", "then", "of", "to", "in",
    "on", "at", "for", "with", "from", "by", "as", "is", "are", "was", "be",
    "has", "have", "had", "do", "does", "did", "will", "would",
    "this", "that", "it", "its", "their", "they",
    "she", "he", "we", "i", "you", "your", "his", "her", "them", "me",
    "my", "our", "us", "any", "all", "some", "every", "each",
}

_SYNONYMS: list[set[str]] = [
    {"ai", "ml", "llm", "gpt", "agent", "agentic", "copilot", "rag", "embedding", "embeddings"},
    {"shipped", "launched", "delivered", "released", "published", "deployed"},
    {"built", "developed", "implemented", "created", "wrote", "authored"},
    {"owned", "led", "drove", "ran", "managed", "championed"},
    {"eval", "evals", "evaluation", "metric", "metrics", "measurement"},
    {"writing", "wrote", "writes", "author", "authored", "blog", "post", "essay"},
    {"frontend", "ui", "ux", "interface", "react", "typescript", "next", "vue", "svelte"},
    {"design", "designer", "designed", "figma", "prototype", "prototyping"},
    {"infra", "infrastructure", "backend", "server", "api", "platform", "distributed"},
    {"founder", "founders", "founding", "early", "startup", "0-1", "0to1"},
    {"hire", "hired", "hiring", "manage", "managed", "manager", "lead", "leads"},
    {"product", "pm", "pms"},
    {"engineer", "engineering", "developer", "dev", "engineers"},
]


def _expand_with_synonyms(words: set[str]) -> set[str]:
    expanded = set(words)
    for group in _SYNONYMS:
        if group & words:
            expanded |= group
    return expanded


def _tokens(text: str) -> set[str]:
    return {
        t.lower()
        for t in re.findall(r"[a-zA-Z][a-zA-Z0-9]{1,}", text or "")
        if t.lower() not in _STOPWORDS
    }


def _phrase_match_ratio(phrase: str, raw_tokens_expanded: set[str]) -> float:
    phrase_tokens = _tokens(phrase)
    if not phrase_tokens:
        return 0.0
    return len(phrase_tokens & raw_tokens_expanded) / len(phrase_tokens)


_STRONG_COMPANY_RE = re.compile(
    r"\b("
    r"Stripe|Notion|Linear|Vercel|Figma|Anthropic|OpenAI|"
    r"Google|Meta|Microsoft|Apple|Amazon|Tesla|SpaceX|"
    r"Datadog|Snowflake|Databricks|Airbnb|Uber|Coinbase|Plaid|"
    r"Copilot|DeepMind|Hugging\s?Face|Cursor|Replit|Cohere|Mistral"
    r")\b", re.IGNORECASE,
)
_ACTION_VERBS = {"shipped", "launched", "delivered", "built", "owned", "led", "drove", "released", "deployed", "managed"}


def _score_role(raw: str, role: dict) -> Tuple[float, list[str]]:
    must = role.get("must_haves") or []
    nice = role.get("nice_haves") or []
    title = role.get("title", "")

    raw_tokens = _tokens(raw)
    raw_expanded = _expand_with_synonyms(raw_tokens)
    title_tokens = _tokens(title)

    must_matches: list[str] = []
    must_credit = 0.0
    for phrase in must:
        ratio = _phrase_match_ratio(phrase, raw_expanded)
        if ratio >= 0.5:
            must_matches.append(phrase)
            must_credit += 1.0
        else:
            must_credit += ratio * 0.7

    nice_matches: list[str] = []
    for phrase in nice:
        if _phrase_match_ratio(phrase, raw_expanded) >= 0.5:
            nice_matches.append(phrase)

    bonus = 0.0
    if (raw_expanded & _ACTION_VERBS) and (title_tokens & raw_expanded):
        bonus += 1.5
    if _LINKEDIN_RE.search(raw) or _LINKEDIN_BARE_RE.search(raw):
        bonus += 0.3
    if re.search(r"\b(?:referred|introduced|recommended|intro|referral)\b", raw, re.IGNORECASE):
        bonus += 0.3
    if re.search(r"\b\d+\s*\+?\s*(?:years?|yrs?)\b", raw, re.IGNORECASE):
        bonus += 0.3
    if _STRONG_COMPANY_RE.search(raw):
        bonus += 0.5

    must_total = max(len(must), 1)
    nice_total = max(len(nice), 1)
    base = 2.5
    must_score = (must_credit / must_total) * 4.0
    nice_score = (len(nice_matches) / nice_total) * 1.5 if nice else 0.0
    score = max(0.0, min(10.0, base + must_score + nice_score + bonus))
    return score, must_matches + nice_matches


def _best_role(raw: str, roles: list[dict]) -> Tuple[Optional[dict], float, list[str]]:
    if not roles:
        return None, 4.0, []
    best: Tuple[Optional[dict], float, list[str]] = (None, 0.0, [])
    for r in roles:
        score, matched = _score_role(raw, r)
        if score > best[1]:
            best = (r, score, matched)
    if best[0] is None:
        return None, 4.0, []
    return best


# ---------------------------------------------------------------------------
# Dossier rendering (inlined, condensed)
# ---------------------------------------------------------------------------

def _render_dossier(
    name: str,
    raw: str,
    linkedin_url: Optional[str],
    email: Optional[str],
    referrer: Optional[str],
    channel_hint: str,
    role: Optional[dict],
    score: float,
    matched: list[str],
) -> str:
    snapshot_lines: list[str] = []
    employer_m = re.search(r"\b(?:at|from|with)\s+([A-Z][A-Za-z0-9\.\&]+(?:\s+[A-Z][A-Za-z0-9\.\&]+){0,2})\b", raw)
    if employer_m:
        snapshot_lines.append(f"- Currently at: {employer_m.group(1).strip()}")
    years_m = re.search(r"(\d{1,2})\s*(?:\+)?\s*(?:years?|yrs?)", raw, re.IGNORECASE)
    if years_m:
        snapshot_lines.append(f"- Experience: {years_m.group(1)}+ years")
    edu_m = re.search(r"\b(MIT|Stanford|Berkeley|CMU|IIT|IIM|BITS|Harvard|Princeton|Yale|Oxford|Cambridge|UCL|ETH)\b", raw)
    if edu_m:
        snapshot_lines.append(f"- Education signal: {edu_m.group(1)}")
    if email:
        snapshot_lines.append(f"- Email: {email}")
    if linkedin_url:
        snapshot_lines.append(f"- LinkedIn: {linkedin_url}")
    if referrer:
        snapshot_lines.append(f"- Referrer: {referrer}")
    snapshot_lines.append(f"- Intake channel: {channel_hint}")
    if not snapshot_lines:
        snapshot_lines.append("- Sparse intake — only a name was provided.")

    if role:
        title = role.get("title", "the open role")
        if matched:
            why = (
                f"Likely fit for **{title}**. Intake aligned with rubric "
                f"point(s): " + ", ".join(f'"{m}"' for m in matched[:2]) + "."
            )
        else:
            why = (
                f"Likely fit for **{title}**. No direct must-have overlap "
                "detected in the intake — fit is inferred from title context."
            )
    else:
        why = (
            "No strong match against the currently-open roles. Worth a quick "
            "read regardless — could be referred onward or held for a future role."
        )

    if score >= 8:
        tone = "strong fit signal; founder should reach out today"
    elif score >= 6.5:
        tone = "promising; worth a real intro"
    elif score >= 5:
        tone = "unclear fit; reach out only if pipeline is thin"
    elif score >= 3:
        tone = "misaligned; consider a referral elsewhere"
    else:
        tone = "not a fit for currently-open roles"
    role_phrase = f" against {role['title']}" if role else ""
    confidence = (
        f"Score {score:.1f} / 10{role_phrase} — {tone}. "
        "Score is deterministic (keyword overlap)."
    )

    raw_block = raw.strip()
    if len(raw_block) > 1200:
        raw_block = raw_block[:1200] + "\n\n_(truncated)_"

    return (
        "## Snapshot\n"
        + "\n".join(snapshot_lines)
        + "\n\n"
        "## Why interesting for this role\n"
        f"{why}\n\n"
        "## Confidence\n"
        f"{confidence}\n\n"
        "---\n\n"
        "### Founder's intake note (verbatim)\n"
        f"> {raw_block.replace(chr(10), chr(10) + '> ')}\n"
    )


# ---------------------------------------------------------------------------
# Candidate write (inlined from create_candidate)
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def pipe_to_intake(ctx: FunctionContext, data: PipeToIntakeInput) -> PipeToIntakeResult:
    raw = (data.raw or "").strip()
    if not raw:
        raise ValueError("`raw` is empty — chat surfaces must forward at least one line.")

    pod = Pod.from_env()

    channel = data.channel_hint if data.channel_hint in _VALID_CHANNEL_HINTS else "manual"

    # --- parse ---
    linkedin_url = _extract_linkedin(raw)
    email_m = _EMAIL_RE.search(raw)
    email = email_m.group(0) if email_m else None
    referrer = _extract_referrer(raw)
    source = _detect_source(raw, linkedin_url, referrer, channel)
    name = _extract_name(raw, linkedin_url)

    # role scoring
    explicit_slug = (data.role_slug or "").strip() or None
    roles_for_match: list[dict] = []
    if explicit_slug:
        explicit = _list_items(pod.records.list(
            "roles", limit=1,
            filter=[{"field": "slug", "op": "eq", "value": explicit_slug}],
        ))
        if explicit:
            roles_for_match = [explicit[0]]
    if not roles_for_match:
        roles_for_match = _list_items(pod.records.list(
            "roles", limit=100,
            filter=[{"field": "status", "op": "eq", "value": "open"}],
        ))
    role, score, matched = _best_role(raw, roles_for_match)
    role_slug: Optional[str] = role.get("slug") if role else None

    if score >= 7:
        next_action = f"Draft intro outreach for {name} (high fit signal)."
    elif score >= 5:
        next_action = f"Review {name}'s dossier; draft outreach if pipeline is light."
    elif score >= 3:
        next_action = f"{name} is misaligned for current roles — consider a referral or pass."
    else:
        next_action = "Pass — not a fit for current roles."

    dossier_markdown = _render_dossier(
        name=name, raw=raw, linkedin_url=linkedin_url, email=email,
        referrer=referrer, channel_hint=channel,
        role=role, score=score, matched=matched,
    )

    # --- create_candidate (inline) ---
    role_id = role["id"] if role else None

    referrer_id = None
    if referrer:
        ref_items = _list_items(pod.records.list(
            "referrers", limit=1,
            filter=[{"field": "name", "op": "eq", "value": referrer}],
        ))
        if ref_items:
            referrer_id = ref_items[0]["id"]
        else:
            new_ref = pod.table("referrers").create({
                "name": referrer,
                "preferred_channel": "whatsapp",
                "auto_update_approved": False,
            })
            referrer_id = new_ref["id"]

    public_token = _generate_public_token(name)

    record = pod.table("candidates").create({
        "name": name,
        "email": email,
        "linkedin_url": linkedin_url,
        "source": source,
        "source_meta": {"referrer_name": referrer} if referrer else {},
        "role_id": role_id,
        "referrer_id": referrer_id,
        "stage": "sourced",
        "status": "active",
        "score": round(score, 1),
        "next_action": next_action,
        "public_token": public_token,
        "owner_user_id": str(ctx.user_id),
    })

    candidate_id = str(record["id"])
    candidate_number = int(record["number"])
    dossier_path = f"/candidates/{candidate_id}/dossier.md"

    header = (
        f"# {name}\n\n"
        f"*Sourced {datetime.utcnow().strftime('%Y-%m-%d')} · "
        f"{source}{' · referred by ' + referrer if referrer else ''}*\n\n"
        "---\n\n"
    )
    pod.files.write_text(dossier_path, header + dossier_markdown + "\n")
    pod.table("candidates").update(candidate_id, {"dossier_path": dossier_path})

    return PipeToIntakeResult(
        candidate_id=candidate_id,
        candidate_number=candidate_number,
        name=name,
        score=round(score, 1),
        role_slug=role_slug,
        dossier_path=dossier_path,
        public_token=public_token,
    )
