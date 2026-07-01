#input_type_name: ParseIntakeInput
#output_type_name: ParseIntakeOutput
#function_name: parse_intake

"""
Deterministic intake parser.

Replaces the unreliable LLM `intake_parser` agent. Given a raw intake string —
LinkedIn URL, voice-note transcript, paste, or referral note — extracts
structured fields and writes a *real* dossier markdown with the founder's own
words embedded as context.

The dossier is functional, not flashy: it captures what the founder said,
extracts whatever facts the regexes can pull out, scores keyword overlap
against the open roles, and renders one ready-to-skim panel. The downstream
outreach_drafter agent can still rewrite/enrich it later — but the founder
sees real content from minute zero.
"""

import re
from datetime import datetime
from typing import Any, List, Optional, Tuple
from urllib.parse import urlparse

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class ParseIntakeInput(BaseModel):
    raw: str
    channel_hint: str = "manual"
    role_slug: Optional[str] = Field(
        default=None,
        description=(
            "When set, score against this specific role instead of best-matching across all open roles. "
            "Used when the founder explicitly adds a candidate to a role from the Roles tab — no "
            "ambiguity, no auto-detection, just 'evaluate this person for THAT job'."
        ),
    )


class ParseIntakeOutput(BaseModel):
    name: str
    email: Optional[str] = None
    linkedin_url: Optional[str] = None
    source: str
    referrer_name: Optional[str] = None
    role_slug: Optional[str] = None
    score: float = Field(ge=0, le=10)
    next_action: str
    dossier_markdown: str


# ---------------------------------------------------------------------------
# Extraction helpers
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
# Words that show up in transcripts that are NOT the candidate's name
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
    # strip trailing identifier hashes like "-39b44434a"
    raw = re.sub(r"-[a-f0-9]{6,}$", "", raw)
    parts = [p for p in re.split(r"[-._]+", raw) if p and not p.isdigit()]
    return " ".join(p.capitalize() for p in parts) if parts else "Candidate"


def _extract_name(raw: str, linkedin_url: Optional[str]) -> str:
    """Find the most likely candidate name from the raw input.

    Strategy (best signal first):
    1. Two consecutive TitleCase words ("Aarti Mehta") — skip if first word is
       a sentence-starter ("Saw John on twitter" → fallthrough).
    2. After a sentence-starter, take the single TitleCase word that follows
       ("Saw John ..." → "John").
    3. LinkedIn URL slug → derived name.
    4. First short line, normalized.
    """
    head = raw[:240].replace("—", " ").replace("–", " ")
    sentences = re.split(r"[\n.,;:!?]", head)

    # Pass 1: two TitleCase words, no prefix word
    for chunk in sentences:
        chunk = chunk.strip()
        if not chunk:
            continue
        m = re.search(r"\b([A-Z][a-z]{1,15})\s+([A-Z][a-z]{1,20})\b", chunk)
        if m:
            first, last = m.group(1), m.group(2)
            if first.lower() in _NAME_PREFIX_BLOCKLIST:
                continue
            if last.lower() in _NAME_BLOCKLIST:
                continue
            return f"{first} {last}"

    # Pass 2: prefix-word followed by a single TitleCase word ("Saw John …")
    for chunk in sentences:
        chunk = chunk.strip()
        if not chunk:
            continue
        m = re.search(
            r"\b(?:saw|met|spoke|spotted|found|got|hey|hi|hello|quick\s+note|note|chat\s+with|talked\s+to|intro\s+with)\s+([A-Z][a-z]{2,20})\b",
            chunk,
            re.IGNORECASE,
        )
        if m:
            return m.group(1)

    if linkedin_url:
        slug = linkedin_url.rstrip("/").rsplit("/", 1)[-1]
        derived = _name_from_linkedin_slug(slug)
        if derived and derived != "Candidate":
            return derived

    # Pass 3: a single TitleCase word at the absolute start of the text
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
    if channel_hint in {"linkedin", "referral", "inbound_email", "twitter", "site", "manual"}:
        return channel_hint
    return "manual"


# ---------------------------------------------------------------------------
# Role matching
# ---------------------------------------------------------------------------

_STOPWORDS = {
    # Pure-grammar words only — verbs like "shipped"/"launched" are KEPT because
    # they're meaningful in role descriptions and intakes.
    "a", "an", "the", "and", "or", "but", "if", "then", "of", "to", "in",
    "on", "at", "for", "with", "from", "by", "as", "is", "are", "was", "be",
    "has", "have", "had", "do", "does", "did", "will", "would",
    "this", "that", "it", "its", "their", "they",
    "she", "he", "we", "i", "you", "your", "his", "her", "them", "me",
    "my", "our", "us", "any", "all", "some", "every", "each",
}

# Equivalence groups — if any synonym in the group appears in the raw text,
# any other one in the same group counts as present too. This is the main
# "smart match" mechanism without needing an LLM.
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
    """If any word in a synonym group is present, mark the whole group present."""
    expanded = set(words)
    for group in _SYNONYMS:
        if group & words:
            expanded |= group
    return expanded


def _tokens(text: str) -> set[str]:
    """Lowercase token set with 2+ letter words, stopwords removed."""
    return {
        t.lower()
        for t in re.findall(r"[a-zA-Z][a-zA-Z0-9]{1,}", text or "")
        if t.lower() not in _STOPWORDS
    }


def _phrase_match_ratio(phrase: str, raw_tokens_expanded: set[str]) -> float:
    """Fraction of the *content words* in `phrase` that appear in raw text
    (after synonym expansion). 1.0 = every content word matched.
    """
    phrase_tokens = _tokens(phrase)
    if not phrase_tokens:
        return 0.0
    overlap = phrase_tokens & raw_tokens_expanded
    return len(overlap) / len(phrase_tokens)


_STRONG_COMPANY_RE = re.compile(
    r"\b("
    r"Stripe|Notion|Linear|Vercel|Figma|Anthropic|OpenAI|"
    r"Google|Meta|Microsoft|Apple|Amazon|Tesla|SpaceX|"
    r"Datadog|Snowflake|Databricks|Airbnb|Uber|Coinbase|Plaid|"
    r"Copilot|DeepMind|Hugging\s?Face|Cursor|Replit|Cohere|Mistral"
    r")\b",
    re.IGNORECASE,
)
_ACTION_VERBS = {"shipped", "launched", "delivered", "built", "owned", "led", "drove", "released", "deployed", "managed"}


def _score_role(raw: str, role: dict) -> Tuple[float, list[str]]:
    """Return (score 0..10, list of matched phrases).

    Intakes describe what someone *did* ("shipped X at Y"), while role rubrics
    describe abstract qualities ("Strong writing"). Naive overlap therefore
    under-scores great candidates. We compensate with explicit high-signal
    bonuses for the patterns real founder intakes contain.
    """
    must = role.get("must_haves") or []
    nice = role.get("nice_haves") or []
    title = role.get("title", "")

    raw_tokens = _tokens(raw)
    raw_expanded = _expand_with_synonyms(raw_tokens)
    title_tokens = _tokens(title)

    # 1) Must-have phrase coverage (with partial credit for near-misses)
    must_matches: list[str] = []
    must_credit = 0.0
    for phrase in must:
        ratio = _phrase_match_ratio(phrase, raw_expanded)
        if ratio >= 0.5:
            must_matches.append(phrase)
            must_credit += 1.0
        else:
            must_credit += ratio * 0.7

    # 2) Nice-to-have coverage
    nice_matches: list[str] = []
    for phrase in nice:
        if _phrase_match_ratio(phrase, raw_expanded) >= 0.5:
            nice_matches.append(phrase)

    # 3) High-signal bonuses — the patterns intakes actually contain
    bonus = 0.0
    has_action_verb = bool(raw_expanded & _ACTION_VERBS)
    has_domain_match = bool(title_tokens & raw_expanded)
    if has_action_verb and has_domain_match:
        # "shipped <domain thing>" — the single strongest intake signal
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

    base = 2.5  # any real intake earns a "worth a glance" floor
    must_score = (must_credit / must_total) * 4.0  # up to +4.0
    nice_score = (len(nice_matches) / nice_total) * 1.5 if nice else 0.0  # up to +1.5

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
# Dossier rendering
# ---------------------------------------------------------------------------

def _facts_block(
    name: str,
    raw: str,
    linkedin_url: Optional[str],
    email: Optional[str],
    referrer: Optional[str],
    channel_hint: str,
) -> str:
    lines = []
    # Extract company/employer hints — look for "at <Company>" or "from <Company>"
    employer_m = re.search(r"\b(?:at|from|with)\s+([A-Z][A-Za-z0-9\.\&]+(?:\s+[A-Z][A-Za-z0-9\.\&]+){0,2})\b", raw)
    if employer_m:
        lines.append(f"- Currently at: {employer_m.group(1).strip()}")
    # Years of experience
    years_m = re.search(r"(\d{1,2})\s*(?:\+)?\s*(?:years?|yrs?)", raw, re.IGNORECASE)
    if years_m:
        lines.append(f"- Experience: {years_m.group(1)}+ years")
    # Education
    edu_m = re.search(r"\b(MIT|Stanford|Berkeley|CMU|IIT|IIM|BITS|Harvard|Princeton|Yale|Oxford|Cambridge|UCL|ETH)\b", raw)
    if edu_m:
        lines.append(f"- Education signal: {edu_m.group(1)}")
    # Location
    loc_m = re.search(r"\b(?:in|based\s+in|out\s+of)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b", raw)
    if loc_m and loc_m.group(1) not in {"Microsoft", "Google", "Meta", "Apple", "Amazon", "Stripe", "Notion", "Linear"}:
        lines.append(f"- Location: {loc_m.group(1)}")

    if email:
        lines.append(f"- Email: {email}")
    if linkedin_url:
        lines.append(f"- LinkedIn: {linkedin_url}")
    if referrer:
        lines.append(f"- Referrer: {referrer}")
    lines.append(f"- Intake channel: {channel_hint}")
    if not lines:
        lines.append("- Sparse intake — only a name was provided.")
    return "\n".join(lines)


def _why_interesting(raw: str, role: Optional[dict], matched: list[str]) -> str:
    """Produce 2-4 sentences naming the role and the specific overlap."""
    if not role:
        return (
            "No strong match against the currently-open roles. Worth a quick read regardless — "
            "the founder may want to consider this candidate for an upcoming role or refer them onward."
        )
    title = role.get("title", "the open role")
    parts = [f"Likely fit for **{title}**."]
    if matched:
        first = matched[0]
        if len(matched) >= 2:
            parts.append(
                f'The intake mentions signal aligned with two rubric points: "{matched[0]}" and "{matched[1]}".'
            )
        else:
            parts.append(f'The intake mentions signal aligned with one rubric point: "{first}".')
    else:
        parts.append("The intake doesn't surface direct must-have overlap — fit is inferred from role title context only.")
    parts.append("Verify by skimming their public artifacts (LinkedIn, GitHub, talks) before drafting outreach.")
    return " ".join(parts)


def _concerns(raw: str, role: Optional[dict], matched: list[str]) -> list[str]:
    out: list[str] = []
    if role:
        must = role.get("must_haves") or []
        unmatched = [m for m in must if m not in matched]
        if unmatched:
            out.append(
                f"Intake didn't confirm: {', '.join(unmatched[:3])}. Probe in the intro call."
            )
    if "ex-" in raw.lower() or "former" in raw.lower():
        out.append("Intake references past affiliations — confirm what they're doing *now* before reaching out.")
    if len(raw) < 80:
        out.append("Intake is very short — most of the dossier is inferred. Add more context after a LinkedIn pass.")
    if not out:
        out.append("Standard caution: verify shipping history, references, and current obligations before scheduling.")
    return out


def _talking_points(raw: str, name: str, role: Optional[dict]) -> list[str]:
    """Try to surface 3 specific talking points by mining the raw input itself."""
    points: list[str] = []
    # Look for "shipped X" / "launched X" / "built X" phrases
    shipped = re.findall(r"\b(?:shipped|launched|built|owned)\s+([^,.\n]{4,80})", raw, re.IGNORECASE)
    for s in shipped[:2]:
        points.append(f"Ask about: {s.strip().rstrip('.').rstrip(',')} — get the rough edges, not the press release.")
    # "ex-X" / "was at X"
    prior = re.findall(r"\b(?:ex-|formerly|previously|was\s+at|before\s+that)\s+([A-Z][\w\.]+)", raw)
    for p in prior[:1]:
        points.append(f"Compare-and-contrast their {p} years with where they are now — what changed in how they ship?")
    # Specific tech mentions
    tech = re.findall(r"\b(?:agent(?:ic)?|RAG|eval|LLM|frontend|infra|distributed|founders?|design\s+system|0[\s\->]+1)\b", raw, re.IGNORECASE)
    if tech and len(points) < 3:
        first_tech = tech[0]
        points.append(f"Pressure-test their take on {first_tech} — surface-level enthusiasm vs. having actually done it.")
    role_specific = {
        "ai-pm": "Ask them to walk through one AI feature they've shipped end-to-end — what was the eval loop?",
        "fe-senior": "Ask about one ambitious UI animation or interaction they shipped — and what almost killed it.",
        "founding-de": "Ask what their tightest design + engineering collab looked like — who held the pen on each call?",
    }
    if role and role.get("slug") in role_specific and len(points) < 3:
        points.append(role_specific[role["slug"]])
    while len(points) < 3:
        points.append("Ask about a recent rough call they made — the kind they'd defend in a post-mortem.")
    return points[:3]


def _prep_questions(role: Optional[dict]) -> list[str]:
    if role and role.get("slug") == "ai-pm":
        return [
            "Walk me through the most ambitious AI feature you've shipped end-to-end. What was your eval loop?",
            "Where do you think the AI PM role is going in the next 18 months? What's overrated, what's underrated?",
            "Tell me about a time you killed an AI feature in development. What was the call?",
        ]
    if role and role.get("slug") == "fe-senior":
        return [
            "Tell me about the last UI you shipped that you're most proud of. What was the hardest part?",
            "How do you decide between a custom-built component and a library one?",
            "Walk me through your debugging process for a layout bug you couldn't reproduce locally.",
        ]
    if role and role.get("slug") == "founding-de":
        return [
            "Tell me about a time design and engineering disagreed. How did you resolve it?",
            "What's the smallest design system you've worked with? How did you scale it?",
            "Show me a UI you built recently — what would you change about it now?",
        ]
    return [
        "Tell me about the rough edge of your last project — the part you don't usually mention.",
        "What's a hard call you made recently that you'd defend even in retrospect?",
        "What would you need from the founder in your first 90 days to do your best work?",
    ]


def _confidence_line(score: float, role: Optional[dict]) -> str:
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
    return f"Score {score:.1f} / 10{role_phrase} — {tone}. Score is deterministic (keyword overlap), so trust your read over the number."


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
    snapshot = _facts_block(name, raw, linkedin_url, email, referrer, channel_hint)
    why = _why_interesting(raw, role, matched)
    concerns = _concerns(raw, role, matched)
    talking = _talking_points(raw, name, role)
    prep = _prep_questions(role)
    confidence = _confidence_line(score, role)
    raw_block = raw.strip()
    if len(raw_block) > 1200:
        raw_block = raw_block[:1200] + "\n\n_(truncated)_"

    return (
        f"## Snapshot\n"
        f"{snapshot}\n\n"
        f"## Why interesting for this role\n"
        f"{why}\n\n"
        f"## Concerns / things to watch\n"
        + "\n".join(f"- {c}" for c in concerns)
        + "\n\n"
        f"## Talking points (3)\n"
        + "\n".join(f"{i + 1}. {p}" for i, p in enumerate(talking))
        + "\n\n"
        f"## Prep questions (3)\n"
        + "\n".join(f"{i + 1}. {q}" for i, q in enumerate(prep))
        + "\n\n"
        f"## Confidence\n"
        f"{confidence}\n\n"
        f"---\n\n"
        f"### Founder's intake note (verbatim)\n"
        f"> {raw_block.replace(chr(10), chr(10) + '> ')}\n"
    )


def _items(response: Any) -> list[dict[str, Any]]:
    if hasattr(response, "to_dict"):
        return response.to_dict().get("items") or []
    if isinstance(response, dict):
        return response.get("items") or []
    return list(getattr(response, "items", []) or [])


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def parse_intake(ctx: FunctionContext, data: ParseIntakeInput) -> ParseIntakeOutput:
    raw = (data.raw or "").strip()
    if not raw:
        raise ValueError("Intake `raw` text is empty — paste something before running intake.")

    pod = Pod.from_env()

    linkedin_url = _extract_linkedin(raw)
    email_m = _EMAIL_RE.search(raw)
    email = email_m.group(0) if email_m else None
    referrer = _extract_referrer(raw)
    source = _detect_source(raw, linkedin_url, referrer, data.channel_hint)
    name = _extract_name(raw, linkedin_url)

    # Role resolution: explicit slug (founder hit "Add candidate" on a specific
    # role) wins over auto-detection. Falling back to best-match keeps the
    # generic "Drop anything" intake button on the kanban working.
    explicit_slug = (data.role_slug or "").strip() or None
    if explicit_slug:
        explicit = _items(
            pod.records.list(
                "roles",
                limit=1,
                filter=[{"field": "slug", "op": "eq", "value": explicit_slug}],
            )
        )
        if explicit:
            role = explicit[0]
            # Score against this specific role only — using the same keyword
            # overlap math the best-match path uses, just with a candidate
            # list of size 1 so we get a real score instead of accepting it
            # blindly.
            _, score, matched = _best_role(raw, [role])
        else:
            # Slug doesn't resolve — bad UI input or stale data. Don't silently
            # auto-match (would be confusing); fall back to best-match across
            # all open roles, same as if the founder hadn't picked one.
            roles = _items(pod.records.list(
                "roles", limit=100,
                filter=[{"field": "status", "op": "eq", "value": "open"}],
            ))
            role, score, matched = _best_role(raw, roles)
    else:
        roles = _items(pod.records.list(
            "roles", limit=100,
            filter=[{"field": "status", "op": "eq", "value": "open"}],
        ))
        role, score, matched = _best_role(raw, roles)

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
        name=name,
        raw=raw,
        linkedin_url=linkedin_url,
        email=email,
        referrer=referrer,
        channel_hint=data.channel_hint,
        role=role,
        score=score,
        matched=matched,
    )

    return ParseIntakeOutput(
        name=name,
        email=email,
        linkedin_url=linkedin_url,
        source=source,
        referrer_name=referrer,
        role_slug=role_slug,
        score=round(score, 1),
        next_action=next_action,
        dossier_markdown=dossier_markdown,
    )
