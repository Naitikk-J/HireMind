#input_type_name: DraftOutreachInput
#output_type_name: DraftOutreachResult
#function_name: draft_outreach

"""
Deterministic outreach drafter.

The original `outreach_drafter` was an LLM agent — and with no model wired
into the local stack, every outreach run failed silently at the AGENT node,
leaving the Drafts queue empty even though the workflow completed.

This function reproduces the agent's *output contract* (subject, body,
voice_check) using the data we already have in the pod:
  * the candidate row (name, source, referrer, role, score)
  * their dossier markdown (already author-quality, by parse_intake)
  * the role's pitch file (/knowledge/roles/<slug>/pitch.md)
  * the founder's voice principles (/knowledge/founder-voice.md)

The structure follows the actual sample in founder-voice.md:

    Subject: <short, lowercase, references a specific thing>

    Hey <first name> — <one concrete observation about THEM, drawn from
    dossier highlights or matched companies>. <one-sentence why-this-role
    quote from the role's pitch.md>.

    Worth 25 minutes next week to see if it's a fit either way?

    <founder first name>

If we don't have enough signal for a concrete hook, the draft still goes
out — but `voice_check` flags that the founder needs to add the missing
context manually, so the operator sees the gap inline in the Drafts queue.
"""

import re
from typing import Any, Optional

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class DraftOutreachInput(BaseModel):
    candidate_id: str
    channel: str = Field(default="email", description="email | linkedin")
    intent: str = Field(
        default="intro",
        description=(
            "What this outreach is for. 'intro' (default — first-touch in the "
            "founder's voice), 'screening_request' (ask candidate for portfolio / "
            "GitHub / availability after they reply), or 'offer_letter' (formal "
            "offer with role + comp + start-date discussion). Drives both the "
            "body content here and the post-send stage transition downstream."
        ),
    )


class DraftOutreachResult(BaseModel):
    subject: str
    body: str
    voice_check: str
    word_count: int
    intent: str


# ---------------------------------------------------------------------------
# Helpers — kept small and obvious so a future LLM swap is just one node
# ---------------------------------------------------------------------------

_FOUNDER_NAME = "Naitik"  # Pulled from founder-voice.md heading.

# Companies that lend themselves to a credible "I saw that you …" opener.
# Identical set to the one in parse_intake so the two agree on signal.
_STRONG_COMPANY_RE = re.compile(
    r"\b("
    r"Stripe|Notion|Linear|Vercel|Figma|Anthropic|OpenAI|"
    r"Google|Meta|Microsoft|Apple|Amazon|Tesla|SpaceX|"
    r"Datadog|Snowflake|Databricks|Airbnb|Uber|Coinbase|Plaid|"
    r"Copilot|DeepMind|Hugging\s?Face|Cursor|Replit|Cohere|Mistral"
    r")\b",
    re.IGNORECASE,
)


def _to_dict(obj: Any) -> dict:
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "to_dict"):
        return obj.to_dict()
    return getattr(obj, "__dict__", {}) or {}


def _first_name(full_name: str) -> str:
    if not full_name:
        return "there"
    head = full_name.strip().split()[0]
    # Strip any trailing punctuation / titles like "Dr." we accidentally caught.
    return re.sub(r"[^\w\-']", "", head) or "there"


def _safe_read_text(pod: Pod, path: str) -> str:
    try:
        blob = pod.files.download(path)
    except Exception:
        return ""
    try:
        return blob.decode("utf-8", errors="replace")
    except Exception:
        return ""


_NUMBERED_RE = re.compile(r"^(\d+)[.)]\s+(.*)$")


def _extract_section(markdown: str, headings_lower: list[str]) -> list[str]:
    """Pull section content out of the first heading whose title contains any
    of the given substrings (case-insensitive). Returns a list of items —
    each bullet/number-list line OR each non-empty paragraph line, whichever
    the section happens to use. Parse_intake's dossiers mix all three styles
    across sections, so accepting all of them keeps the drafter robust to
    minor template drift.
    """
    if not markdown:
        return []
    lines = markdown.splitlines()
    in_section = False
    items: list[str] = []
    paragraph_buf: list[str] = []

    def flush_paragraph() -> None:
        if paragraph_buf:
            joined = " ".join(paragraph_buf).strip()
            if joined:
                items.append(joined)
            paragraph_buf.clear()

    for line in lines:
        stripped = line.strip()
        lower = stripped.lower()

        if lower.startswith("##") or lower.startswith("###"):
            flush_paragraph()
            in_section = any(h in lower for h in headings_lower)
            continue

        if not in_section:
            continue

        if not stripped:
            flush_paragraph()
            continue

        if stripped.startswith("- ") or stripped.startswith("* "):
            flush_paragraph()
            items.append(stripped[2:].strip())
            continue

        m = _NUMBERED_RE.match(stripped)
        if m:
            flush_paragraph()
            items.append(m.group(2).strip())
            continue

        # Plain paragraph line in a section — accumulate.
        paragraph_buf.append(stripped)

    flush_paragraph()
    return items


def _extract_one_sentence_pitch(pitch_md: str) -> str:
    """role pitch files lead with a quoted one-sentence pitch — return it
    stripped of quotes & emphasis markers so we can drop it inline."""
    if not pitch_md:
        return ""
    for line in pitch_md.splitlines():
        s = line.strip()
        if s.startswith("*\"") and s.endswith("\"*"):
            return s.strip("*").strip("\"")
        if s.startswith("\"") and s.endswith("\""):
            return s.strip("\"")
    # Fallback — first non-heading non-empty line, which is usually still useful.
    for line in pitch_md.splitlines():
        s = line.strip()
        if s and not s.startswith("#") and not s.startswith("*") and not s.startswith("-"):
            return s
    return ""


_PLACEHOLDER_MARKERS = (
    "auto-generated",
    "placeholder",
    "didn't produce",
    "didn t produce",
    "verify by skimming",
)

_INTAKE_HEADING = ["founder's intake note", "founder s intake note", "intake note"]


def _is_substantive(text: str) -> bool:
    """Reject parse_intake's apology copy — it reads as boilerplate, not a
    real observation."""
    low = text.lower()
    return not any(marker in low for marker in _PLACEHOLDER_MARKERS)


def _pull_intake_quote(markdown: str) -> str:
    """parse_intake appends the founder's verbatim intake note at the bottom
    of every dossier under '### Founder's intake note (verbatim)'. That note
    is the highest-signal text we have about the candidate — it's the words
    the founder actually used. Strip the leading '>' quote markers."""
    items = _extract_section(markdown, headings_lower=_INTAKE_HEADING)
    if not items:
        return ""
    raw = items[0]
    # Items in this section land as a single paragraph including the '>' the
    # markdown quotes use, so trim that uniformly.
    raw = re.sub(r"^>\s*", "", raw).strip()
    return raw


def _hook_from_dossier_or_raw(*, dossier_md: str, raw_company_text: str, name: str) -> Optional[str]:
    """Return ONE concrete observation we can lead with.

    Priority (highest signal → lowest):
      1. A talking point — these are already candidate-specific ("Ask about: …"),
         and the verb-phrase after the colon makes a clean opener.
      2. The "Why interesting" paragraph if it's substantive (not a placeholder).
      3. A matched well-known company name.
      4. None — caller falls back to a generic-but-honest opener.
    """
    talking_points = _extract_section(dossier_md, headings_lower=["talking point"])
    for tp in talking_points:
        if not _is_substantive(tp):
            continue
        # Talking points tend to look like "Ask about: <thing>" or
        # "Pressure-test their take on <thing>". The <thing> is the
        # interesting bit — yank it out so the opener doesn't sound like
        # an interview-prep note.
        m = re.match(r"^(?:ask about|pressure-test their take on|ask them to walk through one|ask)\s*:?\s*(.+)$", tp, re.IGNORECASE)
        if m:
            return m.group(1).strip().rstrip(".") + "."
        if len(tp) > 220:
            tp = tp[:217].rstrip() + "…"
        return tp

    why_items = _extract_section(dossier_md, headings_lower=["why interesting"])
    for item in why_items:
        if not _is_substantive(item):
            continue
        if len(item) > 220:
            item = item[:217].rstrip() + "…"
        return item

    company_match = _STRONG_COMPANY_RE.search(raw_company_text or "")
    if company_match:
        return f"saw your time at {company_match.group(1)}"
    return None


def _build_subject(*, hook: Optional[str], role_title: str) -> str:
    """Founder-voice subjects are short and lowercase, with one concrete
    reference — never "Hiring at <Company>" or "Opportunity at …".

    Aim for 3–6 content words. Skip stop-words and noise punctuation so the
    line reads as a real thought, not a phrase grep.
    """
    if hook:
        words = re.findall(r"[A-Za-z][A-Za-z\-]+", hook)
        # Drop tiny connectives — subjects sound more human without them.
        keep = [w for w in words if w.lower() not in {"the", "a", "an", "of", "in", "on", "at", "for", "and", "to", "with"}]
        if keep:
            return " ".join(keep[:5]).lower()
    role_phrase = role_title.lower() if role_title else "a role you might like"
    return f"{role_phrase} — quick thought"


_SHIPPED_VERB_RE = re.compile(
    r"\b(?P<verb>shipped|launched|built|delivered|released|deployed)\s+(?P<obj>[^.;]{6,160})",
    re.IGNORECASE,
)


def _extract_specific_achievement(intake_quote: str) -> Optional[tuple[str, str]]:
    """Pull ONE clean verb/object pair from the founder's verbatim intake.

    Returns (verb, object) so the caller can compose its own natural sentence
    instead of welding together fragments that won't parse as English.
    """
    if not intake_quote:
        return None
    m = _SHIPPED_VERB_RE.search(intake_quote)
    if not m:
        return None
    verb = m.group("verb").lower()
    obj = m.group("obj").strip().rstrip(",;:.")
    # Cut at the next semantically heavy boundary so we don't trail into the
    # next sentence: " 12 years experience leading PM teams" was tacked onto
    # "shipped 4 major launches: …" before this fix.
    obj = re.split(
        r"\s*\.\s|\s*\b(?:and|with|while|after|before|throughout|over)\b\s+\d|\s+\d+\s*(?:\+|yrs?|years?)\b",
        obj,
        maxsplit=1,
    )[0].strip().rstrip(",;:")
    if len(obj) > 140:
        obj = obj[:137].rstrip() + "…"
    if not obj:
        return None
    return verb, obj


def _build_body(
    *,
    name: str,
    role_pitch_line: str,
    role_title: str,
    referrer: Optional[str],
    achievement: Optional[tuple[str, str]],
    company: Optional[str],
) -> str:
    """Compose a real founder-voice body.

    Structure matches founder-voice sample 1 exactly:
      L1: "Hey <name> — <specific observation>. <why it matters to the role>."
      L2: <one-line role pitch>
      L3: "Worth 25 minutes next week to see if it's a fit either way?"
      L4: <founder first name on its own line>
    """
    first = _first_name(name)
    paragraphs: list[str] = []

    # 1. Opener — assemble from achievement (best), then company, then generic.
    if achievement:
        verb, obj = achievement
        location_clause = f" at {company}" if company else ""
        observation = f"saw you {verb} {obj}{location_clause}"
        opener = (
            f"Hey {first} — {observation}. "
            "That kind of insertion-point thinking is exactly what I'm trying to hire for."
        )
    elif company:
        opener = (
            f"Hey {first} — your time at {company} jumped out at me. "
            "That kind of context is exactly what I'm trying to hire for."
        )
    else:
        opener = (
            f"Hey {first} — short note, no pitch deck. "
            "Your background overlaps with a role I'm working on and I'd rather just reach out than wait for a perfect setup."
        )
    paragraphs.append(opener)

    # 2. Referrer credit (PRD calls this out as a high-trust shortcut).
    if referrer:
        paragraphs.append(
            f"{referrer} mentioned you might be open to a conversation, "
            "but figured I'd reach out directly rather than play telephone."
        )

    # 3. Role context — borrowed from the role's pitch.md one-liner.
    role_label = role_title or "the founding role we're opening"
    if role_pitch_line:
        paragraphs.append(f"{role_label}, founding team. {role_pitch_line}")
    else:
        paragraphs.append(
            f"{role_label}, founding team. Small group, ships weekly, no roadmap theatre."
        )

    # 4. The single soft ask, copied from founder-voice sample 1.
    paragraphs.append("Worth 25 minutes next week to see if it's a fit either way?")

    # 5. Sign-off — just the first name on its own line, per voice principles.
    paragraphs.append(_FOUNDER_NAME)

    return "\n\n".join(paragraphs)


# ---------------------------------------------------------------------------
# Screening request builder
#
# Sent after a candidate replies positively to the intro. The point is to get
# the artefacts we need before scheduling: portfolio links, references,
# salary expectations, availability window. Tone matches the intro voice —
# direct, no jargon — and explicitly tells them how long the screening will
# take, because vague timelines are the #1 reason engineers ghost.
# ---------------------------------------------------------------------------

def _build_screening_subject(role_title: str) -> str:
    role = role_title.strip()
    if role:
        return f"next steps for {role.lower()}"
    return "next steps before we book a call"


def _build_screening_body(*, name: str, role_title: str) -> str:
    first = _first_name(name)
    role_label = role_title or "the role"
    return (
        f"Hey {first} — quick one before we get on a call.\n\n"
        f"Couple of things that'll make the {role_label} screen actually useful (rather "
        "than the usual 30 min of getting-to-know-you noise):\n\n"
        "1. A link or two to recent work you're proud of. Doesn't have to be polished — "
        "a PR, a side project, a deep-dive doc you wrote. Whatever's the most honest "
        "signal of how you think.\n"
        "2. Rough comp expectations + earliest realistic start date. We'd rather know "
        "now than three calls in.\n"
        "3. One or two references we can talk to before or after the offer — your call "
        "on timing.\n\n"
        "Once I've gone through that, I'll come back with either a real 45-min screen "
        "or a clear pass with reasoning. No black-box silence either way.\n\n"
        f"{_FOUNDER_NAME}"
    )


# ---------------------------------------------------------------------------
# Offer letter builder
#
# Sent after onsite_done (or directly from screen_done if we're skipping
# onsite). This is the *intro* to the offer — the actual signed letter is a
# separate document. The email's job is to land the offer warmly, name the
# specifics that matter (role, comp band, start date), and set a one-week
# response window so the pipeline doesn't stall.
# ---------------------------------------------------------------------------

def _build_offer_subject(*, name: str, role_title: str) -> str:
    first = _first_name(name)
    role = role_title.strip()
    if role:
        return f"the offer for {first} — {role.lower()}"
    return f"the offer for {first}"


def _build_offer_body(*, name: str, role_title: str) -> str:
    first = _first_name(name)
    role_label = role_title or "the founding role"
    return (
        f"Hey {first} — short and direct.\n\n"
        f"We'd like to make you an offer for {role_label}. Formal letter "
        "with comp, equity, start date, and the usual paperwork is in a separate "
        "follow-up — this is the heads-up so you can think about it without a "
        "PDF in your face.\n\n"
        "Headline terms (the letter has the full version):\n"
        "- Title and scope as we discussed.\n"
        "- Cash + equity band already shared in the screen — happy to revisit any "
        "  piece if your situation needs it.\n"
        "- Start date: ideally within 4 weeks; flexible if you have a notice "
        "  period to honour.\n\n"
        "Take a week to sit with it. If you want a call to ask anything — comp, "
        "the team, what the first 90 days actually look like — just say when and "
        "I'll find time.\n\n"
        "Either way, no awkward silence. Looking forward to your reply.\n\n"
        f"{_FOUNDER_NAME}"
    )


def _voice_check(*, body: str, hook: Optional[str], referrer: Optional[str]) -> str:
    """One-sentence honest critique the founder can scan before approving."""
    word_count = len(re.findall(r"\S+", body))
    pieces: list[str] = []
    if word_count < 70:
        pieces.append(f"only {word_count} words — voice file targets 80–130")
    elif word_count > 140:
        pieces.append(f"{word_count} words — tighter is better, voice file caps at 130")
    if not hook:
        pieces.append("no candidate-specific hook — opener is generic, edit before sending")
    if "excited" in body.lower():
        pieces.append("contains 'excited' — founder voice rules forbid it")
    if not pieces:
        return f"{word_count} words, in voice range, leads with a concrete reference."
    return "Voice check: " + "; ".join(pieces) + "."


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

_VALID_INTENTS = ("intro", "screening_request", "offer_letter", "rejection")


# ---------------------------------------------------------------------------
# Rejection builder
#
# Sent after a stage transition past first-touch when the founder has decided
# to pass. The whole point of an AI-drafted rejection is that it's kind AND
# specific — citing the actual gap that drove the no, plus a sincere line
# acknowledging signal we DID see, so the candidate leaves the loop with
# dignity instead of a black-box silence. The tone is the founder's: short,
# direct, no "we received many strong applicants" boilerplate.
#
# Composition recipe:
#   1. Greet by first name.
#   2. State the no without ambiguity (no "we'll keep your CV on file" lies).
#   3. ONE specific reason, derived from the dossier's "Concerns" section
#      and/or the role's must_haves the candidate didn't match. We never
#      invent gaps that aren't on the dossier.
#   4. ONE genuine line acknowledging what we DID like (from "Why
#      interesting"), so the rejection doesn't read as dismissive.
#   5. Soft close: future-fit invitation if signal is real, plain
#      acknowledgement if not.
#   6. Sign-off with founder's first name only.
# ---------------------------------------------------------------------------

def _extract_dossier_sections(dossier_md: str) -> dict[str, list[str]]:
    """Pull the bullet lists out of the dossier's standard sections.

    Mirrors triage_and_notify's extractor — kept independent here so this
    function stays self-contained, but the heuristics match: look for h2/h3
    headings ("Why interesting", "Concerns", "Talking points"), then collect
    bullet lines (-, *) until the next heading.
    """
    sections: dict[str, list[str]] = {"why": [], "concerns": [], "talking": []}
    if not dossier_md:
        return sections
    current: Optional[str] = None
    for line in dossier_md.splitlines():
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


def _pick_specific_gap(concerns: list[str], role_must_haves: list[str], dossier_md: str) -> Optional[str]:
    """Return one sentence-length phrase describing the actual gap, or None.

    Strategy, in order of preference:
      1. If a concern bullet is concrete (mentions a noun ≥ 4 chars), quote it.
      2. Otherwise, find the must-have whose keywords are most absent from the
         dossier — that's the implicit gap the rubric caught.
      3. If neither yields signal, return None so the body falls back to a
         generic-but-honest "this round is going to a candidate with more
         direct overlap" line. Worse to invent a reason than to omit one.
    """
    for c in concerns:
        c_clean = c.strip().rstrip(".")
        if len(c_clean) >= 20 and re.search(r"\b[a-zA-Z]{4,}\b", c_clean):
            # Lowercase first char so it reads as a continuation.
            return c_clean[0].lower() + c_clean[1:]
    if role_must_haves and dossier_md:
        dossier_low = dossier_md.lower()
        # Score each must-have by absence: count how many of its content words
        # (≥4 chars, alphabetic) are MISSING from the dossier. Highest absence
        # = biggest gap. We surface the must-have verbatim if a strong miss.
        def _miss_score(must: str) -> int:
            words = [w for w in re.findall(r"[a-zA-Z]{4,}", must.lower()) if w not in {"with", "from", "this", "that", "have", "been", "experience"}]
            if not words:
                return -1
            missing = sum(1 for w in words if w not in dossier_low)
            return missing
        scored = sorted(
            ((m, _miss_score(m)) for m in role_must_haves if _miss_score(m) > 0),
            key=lambda x: -x[1],
        )
        if scored:
            gap_must, _ = scored[0]
            return f"deeper experience with {gap_must.strip().rstrip('.').lower()}"
    return None


def _pick_positive_signal(why_bullets: list[str]) -> Optional[str]:
    """Return one short positive observation the founder can honestly cite."""
    for w in why_bullets:
        w_clean = w.strip().rstrip(".")
        if 15 <= len(w_clean) <= 140:
            return w_clean[0].lower() + w_clean[1:]
    return None


def _build_rejection_subject(*, name: str, role_title: str) -> str:
    first = _first_name(name)
    role = (role_title or "").strip()
    if role:
        return f"update on {role.lower()} — {first}"
    return f"update on the role — {first}"


def _build_rejection_body(
    *,
    name: str,
    role_title: str,
    gap: Optional[str],
    positive: Optional[str],
    has_real_signal: bool,
) -> str:
    """Compose the rejection body. Kept tight (70-110 words) so it never
    looks like the founder padded it to feel less bad.
    """
    first = _first_name(name)
    role_label = role_title or "the role"
    lines: list[str] = []

    lines.append(f"Hey {first} — wanted to come back to you directly rather than leave you in silence.")

    # The no — phrased as a decision, not as the candidate's failure.
    if gap:
        lines.append(
            f"We're going to pass on moving forward for {role_label} this round. "
            f"The honest reason is {gap} — for this specific hire we need someone "
            "we can drop in without a runway, and that's where the gap landed."
        )
    else:
        lines.append(
            f"We're going to pass on moving forward for {role_label} this round. "
            "The honest reason is we found someone whose overlap was a closer "
            "match for what we need in the first 90 days — nothing about your background "
            "made us pause."
        )

    # The "what we did like" line — only if we found real signal.
    if positive:
        lines.append(f"For the record: {positive} stood out, and that's not a small thing.")

    # Soft close — invitation if signal is real, plain acknowledgement if not.
    if has_real_signal:
        lines.append(
            "If you'd be open to it, I'd keep your details and reach out directly "
            "next time we open a role closer to your shape. No pressure either way."
        )
    else:
        lines.append("Thanks for the time you put into this — genuinely.")

    lines.append(_FOUNDER_NAME)
    return "\n\n".join(lines)


async def draft_outreach(ctx: FunctionContext, data: DraftOutreachInput) -> DraftOutreachResult:
    pod = Pod.from_env()

    candidate = _to_dict(pod.records.get("candidates", data.candidate_id))
    if not candidate:
        raise ValueError(f"Candidate {data.candidate_id} not found.")

    name = candidate.get("name") or "there"
    referrer = candidate.get("source_meta", {}).get("referrer_name") if isinstance(candidate.get("source_meta"), dict) else None

    # Resolve the role title up front — every intent uses it. Pitch + dossier
    # context only matter for the intro path (cold opener needs a hook); the
    # screening and offer paths use templates because the founder/candidate
    # already share context by then and a templated body is *more* useful
    # than a creative rewrite.
    intent = (data.intent or "intro").strip().lower()
    if intent not in _VALID_INTENTS:
        # Don't fail the workflow on a bad value — just degrade to intro and
        # surface the issue in voice_check so the founder sees it before
        # approving.
        bad_intent = intent
        intent = "intro"
    else:
        bad_intent = ""

    role_title_quick = ""
    role_id_quick = candidate.get("role_id")
    if role_id_quick:
        try:
            role_quick = _to_dict(pod.records.get("roles", role_id_quick))
            role_title_quick = role_quick.get("title") or ""
        except Exception:
            pass

    if intent == "screening_request":
        subject = _build_screening_subject(role_title_quick)
        body = _build_screening_body(name=name, role_title=role_title_quick)
        voice_check = (
            "Screening request — templated. Edit if there's something specific you "
            "want from this candidate (e.g. a code sample of X)."
        )
        if bad_intent:
            voice_check += f" (Ignored unknown intent '{bad_intent}' — defaulted to intro.)"
        return DraftOutreachResult(
            subject=subject,
            body=body,
            voice_check=voice_check,
            word_count=len(re.findall(r"\S+", body)),
            intent=intent,
        )

    if intent == "rejection":
        # Rejections lean on the dossier — both the "Concerns" the parser
        # already flagged AND the absence of role must-haves — to produce a
        # specific reason rather than boilerplate. We read these once here so
        # the path stays self-contained.
        dossier_md_for_rej = ""
        dossier_path_for_rej = candidate.get("dossier_path") or ""
        if dossier_path_for_rej:
            dossier_md_for_rej = _safe_read_text(pod, dossier_path_for_rej)
        rej_sections = _extract_dossier_sections(dossier_md_for_rej)
        role_must_haves: list[str] = []
        if role_id_quick:
            try:
                role_full = _to_dict(pod.records.get("roles", role_id_quick))
                mh = role_full.get("must_haves") or []
                if isinstance(mh, list):
                    role_must_haves = [str(x) for x in mh if x]
            except Exception:
                pass
        gap = _pick_specific_gap(
            concerns=rej_sections.get("concerns", []),
            role_must_haves=role_must_haves,
            dossier_md=dossier_md_for_rej,
        )
        positive = _pick_positive_signal(rej_sections.get("why", []))
        # "Has real signal" gates whether we invite future contact. Heuristic:
        # the candidate had both positive bullets in the dossier AND their
        # current score is above 5. Below that, the future-fit invitation
        # would feel performative.
        cand_score = float(candidate.get("score") or 0.0)
        has_real_signal = bool(positive) and cand_score >= 5.0
        subject = _build_rejection_subject(name=name, role_title=role_title_quick)
        body = _build_rejection_body(
            name=name,
            role_title=role_title_quick,
            gap=gap,
            positive=positive,
            has_real_signal=has_real_signal,
        )
        # voice_check is unusually explicit here because the founder *will*
        # want to edit a rejection — surfacing what we pulled out of the
        # dossier helps them spot drift before sending.
        vc_pieces: list[str] = []
        if gap:
            vc_pieces.append(f"reason cites: {gap[:80]}{'…' if len(gap) > 80 else ''}")
        else:
            vc_pieces.append("no specific gap on dossier — used generic-but-honest framing")
        if positive:
            vc_pieces.append("acknowledged a real strength from dossier")
        if not has_real_signal:
            vc_pieces.append("no future-fit invite (score < 5 or no positive signal)")
        voice_check = "Rejection draft — " + "; ".join(vc_pieces) + ". Edit before sending if any of this is off."
        if bad_intent:
            voice_check += f" (Ignored unknown intent '{bad_intent}'.)"
        return DraftOutreachResult(
            subject=subject,
            body=body,
            voice_check=voice_check,
            word_count=len(re.findall(r"\S+", body)),
            intent=intent,
        )

    if intent == "offer_letter":
        subject = _build_offer_subject(name=name, role_title=role_title_quick)
        body = _build_offer_body(name=name, role_title=role_title_quick)
        voice_check = (
            "Offer email — headline terms only. Attach the real letter as a "
            "separate doc before approving. Comp and equity numbers need a "
            "human pass."
        )
        return DraftOutreachResult(
            subject=subject,
            body=body,
            voice_check=voice_check,
            word_count=len(re.findall(r"\S+", body)),
            intent=intent,
        )

    # Role context — title (from the row) and the one-sentence pitch from
    # /knowledge/roles/<slug>/pitch.md when available.
    role_title = ""
    role_slug = ""
    role_pitch_line = ""
    role_id = candidate.get("role_id")
    if role_id:
        try:
            role = _to_dict(pod.records.get("roles", role_id))
            role_title = role.get("title") or ""
            role_slug = role.get("slug") or ""
        except Exception:
            pass
    if role_slug:
        pitch_md = _safe_read_text(pod, f"/knowledge/roles/{role_slug}/pitch.md")
        role_pitch_line = _extract_one_sentence_pitch(pitch_md)

    # Dossier — feeds the hook + voice_check.
    dossier_md = ""
    dossier_path = candidate.get("dossier_path") or ""
    if dossier_path:
        dossier_md = _safe_read_text(pod, dossier_path)

    # The verbatim intake at the bottom of every dossier is the founder's own
    # words — the most reliable source for "what did this person actually do".
    # Pull a single specific shipped/launched X phrase from it.
    intake_quote = _pull_intake_quote(dossier_md)
    achievement = _extract_specific_achievement(intake_quote)

    # The strongest-signal company gets used as a "at <company>" tail — both
    # for the opener's location clause and as a standalone fallback hook.
    company_match = _STRONG_COMPANY_RE.search(intake_quote or dossier_md or "")
    company = company_match.group(1) if company_match else None

    # The hook for subject + voice_check derives from whichever signal we
    # actually used in the body, so the gating stays consistent.
    if achievement:
        verb, obj = achievement
        hook_for_subject = f"{verb} {obj}"
    elif company:
        hook_for_subject = f"{company}"
    else:
        hook_for_subject = ""

    subject = _build_subject(hook=hook_for_subject or None, role_title=role_title)
    body = _build_body(
        name=name,
        role_pitch_line=role_pitch_line,
        role_title=role_title,
        referrer=referrer,
        achievement=achievement,
        company=company,
    )
    voice_check = _voice_check(body=body, hook=hook_for_subject, referrer=referrer)
    word_count = len(re.findall(r"\S+", body))

    return DraftOutreachResult(
        subject=subject,
        body=body,
        voice_check=voice_check,
        word_count=word_count,
        intent="intro",
    )
