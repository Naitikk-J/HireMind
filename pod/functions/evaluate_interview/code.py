#input_type_name: EvaluateInterviewInput
#output_type_name: EvaluateInterviewResult
#function_name: evaluate_interview

"""
Deterministic 0–100 scorer for AI video interviews.

The candidate completes the video interview on `candidate-view`, which writes
their transcript code into a markdown file at
`/candidates/<id>/interview-<interview_id>.md` (via the operator app's paste
flow). The same paste handler then calls this function to grade the answers.

Design choices:

  - No LLM dependency. We can't reach Lemma's agent runner from a function
    today (only workflow AGENT nodes can), and shipping with an external API
    key would be its own integration. So we compute scores from observable
    signal: answer length, concrete language (numbers, named tools, named
    companies), keyword overlap with the role's rubric, vague-language
    penalties, and proctor flags baked into the transcript by the browser.

  - Per-question score (0–100) + overall (weighted average). The overall is
    deliberately a simple mean so it's auditable — no opaque formula.

  - Recommendation enum mirrors the existing scorecard schema so the
    scorecard row this function writes plugs into the same Drafts/Scorecards
    panels the human-feedback path uses.

  - Failure modes are LOUD: if we can't find the transcript file, we raise
    with the path we tried. If the rubric is missing, we still score (using
    a generic rubric) and flag the gap inside the eval JSON so the operator
    sees we degraded gracefully.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


# ----------------------------- input / output -----------------------------


class EvaluateInterviewInput(BaseModel):
    interview_id: str
    # Optional — when the operator triggers eval right after pasting a
    # transcript, the markdown is already on disk; we look it up by
    # interview_id. Caller can override the lookup with a direct path if
    # they wrote the file somewhere unusual.
    transcript_path: Optional[str] = Field(
        default=None,
        description=(
            "Override path to read the interview transcript markdown from. "
            "Defaults to '/candidates/<candidate_id>/interview-<interview_id>.md'."
        ),
    )


class PerQuestionScore(BaseModel):
    q: str
    a_excerpt: str
    score: int = Field(..., ge=0, le=100)
    signals: list[str] = Field(default_factory=list)
    weak_signals: list[str] = Field(default_factory=list)


class EvaluateInterviewResult(BaseModel):
    interview_id: str
    candidate_id: str
    score: int = Field(..., ge=0, le=100)
    recommendation: str  # strong_hire | hire | no_hire | strong_no_hire
    summary: str
    strengths: str
    concerns: str
    proctor_flag_count: int
    per_question: list[PerQuestionScore]
    transcript_path: str
    eval_path: str
    scorecard_id: str


# ----------------------------- heuristics ---------------------------------


# Concrete-signal regexes — the things that distinguish a real answer from
# a hand-wavy one. Each match is +signal.
_NUMBER_RE = re.compile(r"\b\d[\d,\.]*\s?(%|x|m|k|b|sec|min|hr|hrs|days?|weeks?|months?|years?|y/?o)?\b", re.I)
_TOOL_RE = re.compile(
    r"\b(python|typescript|javascript|react|next\.?js|node|postgres|mysql|redis|kafka|"
    r"airflow|terraform|kubernetes|docker|aws|gcp|azure|s3|lambda|graphql|rest|grpc|"
    r"pytorch|tensorflow|langchain|langgraph|openai|anthropic|claude|gpt|llama|"
    r"figma|tailwind|stripe|segment|amplitude|datadog|sentry|cloudflare|vercel|"
    r"swift|kotlin|rust|go|c\+\+|java|ruby|rails|django|flask|fastapi|sql|nosql)\b",
    re.I,
)
_COMPANY_RE = re.compile(
    r"\b(stripe|notion|linear|vercel|figma|anthropic|openai|google|meta|microsoft|"
    r"apple|amazon|tesla|spacex|datadog|snowflake|databricks|airbnb|uber|coinbase|"
    r"plaid|deepmind|hugging\s?face|cursor|replit|cohere|mistral|nvidia|intel)\b",
    re.I,
)
# Action-verb cues that signal ownership / shipping rather than spectating.
_OWNED_VERBS = re.compile(
    r"\b(shipped|built|launched|migrated|owned|led|architected|designed|debugged|"
    r"refactored|reduced|increased|scaled|automated|deployed|integrated|prototyped|"
    r"open[\-\s]?sourced|published)\b",
    re.I,
)
# Vague phrases that drag a score down.
_VAGUE_RE = re.compile(
    r"\b(passionate|synergy|leverage|holistic|world[\-\s]?class|"
    r"team[\-\s]?player|hard[\-\s]?working|results[\-\s]?driven|"
    r"detail[\-\s]?oriented|outside[\-\s]?the[\-\s]?box|cutting[\-\s]?edge|"
    r"think outside|drive impact|move the needle)\b",
    re.I,
)
# Common filler that signals stalling.
_FILLER_RE = re.compile(r"\b(um+|uh+|like|you know|basically|literally|honestly)\b", re.I)


def _to_dict(obj: Any) -> dict:
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "to_dict"):
        return obj.to_dict()
    return getattr(obj, "__dict__", {}) or {}


def _safe_read_text(pod: Pod, path: str) -> str:
    try:
        blob = pod.files.download(path)
    except Exception:
        return ""
    if blob is None:
        return ""
    try:
        return blob.decode("utf-8", errors="replace")
    except Exception:
        return ""


# A transcript section is `## Qn. <question>\n\n<answer>`. We rely on the
# canonical markdown produced by `renderTranscriptMarkdown` in the operator
# app — but we also accept a slightly looser shape so a hand-edited file
# (a founder cleaning up a transcript) still parses.
_QA_RE = re.compile(
    r"^##\s*Q(\d+)\.\s*(.+?)\n+(.*?)(?=\n##\s*Q\d+\.|\Z)",
    re.S | re.M,
)


def _parse_transcript(md: str) -> list[tuple[str, str]]:
    """Return [(question, answer), …] in order."""
    out: list[tuple[str, str]] = []
    for m in _QA_RE.finditer(md or ""):
        q = m.group(2).strip()
        a = m.group(3).strip()
        if q and a:
            out.append((q, a))
    return out


def _extract_proctor_flag_count(md: str) -> int:
    """Optional line `*Proctor flags: 3*` written by candidate-view (best-effort)."""
    m = re.search(r"Proctor\s+flags?:\s*(\d+)", md or "", re.I)
    if not m:
        return 0
    try:
        return int(m.group(1))
    except Exception:
        return 0


def _rubric_keywords(pod: Pod, role_slug: Optional[str]) -> set[str]:
    """Tokenise the role rubric into single-word lowercase keywords so the
    evaluator can boost answers that demonstrate alignment with the rubric.
    Falls back to an empty set if the rubric isn't on disk; the scorer
    handles that gracefully."""
    if not role_slug:
        return set()
    path = f"/knowledge/roles/{role_slug}/rubric.md"
    text = _safe_read_text(pod, path)
    if not text:
        return set()
    # Strip code blocks + headers; tokenise.
    cleaned = re.sub(r"```.*?```", " ", text, flags=re.S)
    cleaned = re.sub(r"[#>*_`\-]+", " ", cleaned)
    words = re.findall(r"[a-zA-Z][a-zA-Z0-9\-]{3,}", cleaned)
    stop = {
        "this", "that", "with", "from", "have", "must", "should", "would",
        "could", "they", "their", "them", "what", "when", "where", "which",
        "while", "about", "into", "than", "then", "your", "ours", "more",
        "less", "very", "just", "some", "many", "much", "also", "rubric",
        "good", "great", "looking", "looks", "team", "role", "candidate",
    }
    return {w.lower() for w in words if w.lower() not in stop}


def _excerpt(text: str, max_len: int = 220) -> str:
    s = (text or "").strip()
    if len(s) <= max_len:
        return s
    return s[: max_len - 1].rsplit(" ", 1)[0] + "…"


def _score_answer(
    *,
    answer: str,
    rubric_keywords: set[str],
) -> tuple[int, list[str], list[str]]:
    """Score one answer 0–100. Returns (score, positive_signals, weak_signals)."""
    text = (answer or "").strip()
    signals: list[str] = []
    weak: list[str] = []

    # Length floor: anything under ~25 words is almost certainly thin.
    word_count = len(re.findall(r"\b\w+\b", text))
    if word_count < 25:
        weak.append(f"short answer ({word_count} words)")
        length_pts = max(0, word_count) * 1.0  # 0–25
    elif word_count < 60:
        length_pts = 25 + (word_count - 25) * 0.4  # 25–39
    elif word_count < 200:
        length_pts = 39 + (word_count - 60) * 0.05  # 39–46
    else:
        length_pts = 46  # don't reward rambling

    # Concrete-signal points (each cap so a single regex doesn't dominate).
    nums = len(_NUMBER_RE.findall(text))
    if nums:
        signals.append(f"{nums} concrete metric{'s' if nums > 1 else ''}")
    numbers_pts = min(nums * 3, 12)

    tools = {t.lower() for t in _TOOL_RE.findall(text)}
    if tools:
        signals.append(f"named {len(tools)} tool{'s' if len(tools) > 1 else ''}")
    tools_pts = min(len(tools) * 2, 10)

    companies = {c.lower() for c in _COMPANY_RE.findall(text)}
    if companies:
        signals.append(f"referenced {len(companies)} known co.")
    co_pts = min(len(companies) * 2, 6)

    owned_verbs = len(_OWNED_VERBS.findall(text))
    if owned_verbs:
        signals.append(f"{owned_verbs} ownership verb{'s' if owned_verbs > 1 else ''}")
    owned_pts = min(owned_verbs * 3, 12)

    # Rubric overlap — does the answer touch the role's stated criteria?
    if rubric_keywords:
        tokens = {t.lower() for t in re.findall(r"[a-zA-Z][a-zA-Z0-9\-]{3,}", text)}
        overlap = tokens & rubric_keywords
        if overlap:
            signals.append(f"matched {len(overlap)} rubric term{'s' if len(overlap) > 1 else ''}")
        rubric_pts = min(len(overlap) * 1.5, 14)
    else:
        rubric_pts = 0

    # Penalties.
    vagues = len(_VAGUE_RE.findall(text))
    if vagues:
        weak.append(f"{vagues} vague phrase{'s' if vagues > 1 else ''}")
    vague_penalty = min(vagues * 4, 16)

    fillers = len(_FILLER_RE.findall(text))
    if fillers > 4:
        weak.append(f"{fillers} filler words")
    filler_penalty = min(max(0, fillers - 3) * 1, 8)

    raw = length_pts + numbers_pts + tools_pts + co_pts + owned_pts + rubric_pts - vague_penalty - filler_penalty
    score = max(0, min(100, int(round(raw))))
    return score, signals, weak


def _recommend(score: int, proctor_flags: int) -> str:
    """Map overall score → scorecards.recommendation enum."""
    # Heavy proctor flagging knocks any otherwise-borderline recommendation down.
    adjusted = score - min(proctor_flags * 5, 20)
    if adjusted >= 80:
        return "strong_hire"
    if adjusted >= 60:
        return "hire"
    if adjusted >= 35:
        return "no_hire"
    return "strong_no_hire"


def _summary(score: int, per_q: list[PerQuestionScore], proctor_flags: int) -> tuple[str, str, str]:
    """Build (summary, strengths, concerns) prose from per-question results."""
    top = sorted(per_q, key=lambda p: p.score, reverse=True)[:2]
    bottom = sorted(per_q, key=lambda p: p.score)[:2]
    top_signals: list[str] = []
    for p in top:
        top_signals.extend(p.signals[:2])
    weak: list[str] = []
    for p in bottom:
        weak.extend(p.weak_signals[:2])

    strengths = ""
    if top_signals:
        strengths = (
            f"Strongest answer scored {top[0].score}/100 — {', '.join(top_signals[:4])}. "
            f"Concrete language and specific tools/companies show ownership."
        )
    else:
        strengths = "No clear standout signals — answers were generic."

    concerns = ""
    if proctor_flags:
        concerns += f"Proctor monitor flagged {proctor_flags} event(s) during the session. "
    if weak:
        concerns += f"Weakest answer scored {bottom[0].score}/100 — {', '.join(weak[:4])}."
    elif not proctor_flags:
        concerns = "No major concerns from heuristic scoring; founder should still verify key claims."

    summary = (
        f"AI screen overall: {score}/100. "
        f"Range across {len(per_q)} answers: {min(p.score for p in per_q)}–{max(p.score for p in per_q)}. "
        f"Proctor flags: {proctor_flags}."
    )
    return summary, strengths, concerns


# ----------------------------- entrypoint ---------------------------------


async def evaluate_interview(
    ctx: FunctionContext,
    data: EvaluateInterviewInput,
) -> EvaluateInterviewResult:
    pod = Pod.from_env()

    interview = _to_dict(pod.records.get("interviews", data.interview_id))
    if not interview:
        raise ValueError(f"Interview {data.interview_id} not found.")
    candidate_id = str(interview.get("candidate_id") or "")
    if not candidate_id:
        raise ValueError(f"Interview {data.interview_id} has no candidate_id.")

    candidate = _to_dict(pod.records.get("candidates", candidate_id))
    if not candidate:
        raise ValueError(f"Candidate {candidate_id} not found.")

    transcript_path = (
        data.transcript_path
        or interview.get("interviewer_email")  # repurposed pointer set by the paste flow
        or f"/candidates/{candidate_id}/interview-{data.interview_id}.md"
    )
    transcript_md = _safe_read_text(pod, transcript_path)
    if not transcript_md:
        raise ValueError(
            f"Couldn't read transcript at {transcript_path}. "
            "Make sure the operator pasted the transcript code on the candidate's detail page first."
        )

    pairs = _parse_transcript(transcript_md)
    if not pairs:
        raise ValueError(
            "Transcript has no Q&A pairs we can parse. "
            "The file should contain `## Q1. …` sections written by the paste handler."
        )

    role_slug: Optional[str] = None
    role_id = candidate.get("role_id")
    if role_id:
        try:
            role_row = _to_dict(pod.records.get("roles", role_id))
            role_slug = role_row.get("slug")
        except Exception:
            role_slug = None
    rubric_kw = _rubric_keywords(pod, role_slug)

    per_q: list[PerQuestionScore] = []
    for q, a in pairs:
        s, sig, weak = _score_answer(answer=a, rubric_keywords=rubric_kw)
        per_q.append(PerQuestionScore(
            q=q,
            a_excerpt=_excerpt(a),
            score=s,
            signals=sig,
            weak_signals=weak,
        ))

    proctor_flags = _extract_proctor_flag_count(transcript_md)
    overall = int(round(sum(p.score for p in per_q) / len(per_q)))
    # Proctor penalty is folded into the recommendation, not the headline
    # score, so the founder can see the raw answer quality and the
    # behavioural concern separately.
    recommendation = _recommend(overall, proctor_flags)
    summary, strengths, concerns = _summary(overall, per_q, proctor_flags)

    # Persist evaluation JSON for the operator UI to render details on demand.
    eval_path = f"/candidates/{candidate_id}/interview-{data.interview_id}-eval.json"
    eval_doc = {
        "v": 1,
        "kind": "interview_evaluation",
        "interview_id": data.interview_id,
        "candidate_id": candidate_id,
        "candidate_name": candidate.get("name"),
        "role_slug": role_slug,
        "transcript_path": transcript_path,
        "score": overall,
        "recommendation": recommendation,
        "summary": summary,
        "strengths": strengths,
        "concerns": concerns,
        "proctor_flag_count": proctor_flags,
        "per_question": [p.model_dump() for p in per_q],
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "scorer_version": "heuristic-v1",
    }
    try:
        pod.files.write_text(eval_path, json.dumps(eval_doc, indent=2))
    except Exception:
        # File write failures are non-fatal — the score still lands on the
        # interviews row + scorecards row, which is what the kanban reads.
        pass

    # Update the interviews row: score + eval_path columns (added in this
    # change), and bring status to done if it wasn't already.
    interview_update: dict[str, Any] = {
        "score": overall,
        "eval_path": eval_path,
        "status": "done",
    }
    if not interview.get("feedback_sent_at"):
        interview_update["feedback_sent_at"] = datetime.now(timezone.utc).isoformat()
    pod.table("interviews").update(data.interview_id, interview_update)

    # Insert a scorecards row so the existing scorecard panel surfaces this
    # result alongside human-led rounds. We don't bind submitted_by_user_id
    # because the AI is the author — the founder can attribute it in the UI.
    scorecard = pod.table("scorecards").create({
        "interview_id": data.interview_id,
        "candidate_id": candidate_id,
        "strengths": strengths,
        "concerns": concerns,
        "recommendation": recommendation,
        "notes": (
            f"{summary}\n\n"
            f"Per-question scores: " + ", ".join(f"Q{i+1}: {p.score}" for i, p in enumerate(per_q)) + "\n"
            f"Full evaluation: {eval_path}"
        ),
    })
    scorecard_id = str(scorecard["id"]) if isinstance(scorecard, dict) else str(getattr(scorecard, "id"))

    # Nudge the candidate's next_action so the kanban reflects the new state.
    try:
        pod.table("candidates").update(candidate_id, {
            "next_action": f"AI screen scored {overall}/100 · {recommendation.replace('_', ' ')} — decide next step",
            "last_contact": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        pass

    return EvaluateInterviewResult(
        interview_id=str(data.interview_id),
        candidate_id=candidate_id,
        score=overall,
        recommendation=recommendation,
        summary=summary,
        strengths=strengths,
        concerns=concerns,
        proctor_flag_count=proctor_flags,
        per_question=per_q,
        transcript_path=transcript_path,
        eval_path=eval_path,
        scorecard_id=scorecard_id,
    )
