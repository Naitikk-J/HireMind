#input_type_name: ScheduleScreenInput
#output_type_name: ScheduleScreenResult
#function_name: schedule_screen

"""
Book a screen on the founder's calendar with a Meet link attached.

The flow this enables — and the reason this lives as its own function
instead of inside the operator app — is end-to-end magic:

  1. Founder taps "Book screen" on a candidate in `replied` stage.
  2. They pick one of the slots proposed by `propose_slots` (or type
     their own time).
  3. This function fires:
       a. `GOOGLECALENDAR_CREATE_EVENT` via the Composio-backed
          `google_calendar` connector, with `create_meeting_room=True`,
          which auto-generates a Meet URL on the event.
       b. The event invites the founder + candidate so both get a real
          calendar invite in their inbox (no copy-paste). Composio's
          `send_updates="all"` mirrors Google's `sendUpdates=all` so
          attendees are notified by email.
       c. We persist an `interviews` row with `round="screen"`,
          `scheduled_at`, `meet_url`, `calendar_event_id`.
       d. Move the candidate's stage to `screen_done` only AFTER the
          screen has actually happened — for now we keep them at
          `replied` with `next_action = "Screen booked for <when>"`.
          The founder explicitly advances to screen_done from the panel
          after the call wraps. (Auto-advancing on schedule would lose
          the "completed the screen" signal.)

Graceful failure surface:
  - Missing auth config → return 503-equivalent with a structured error
    code the operator UI can render as "Connect Google Calendar to enable
    one-click scheduling."
  - Candidate missing email → refuse, since invites without an attendee
    address are useless.
  - Slot parse error → refuse with the exact reason, so the operator UI
    re-opens the date picker rather than guessing.

Composio quirk: Personal Google accounts may successfully create the
event but receive an event WITHOUT a Meet link (Composio falls back
silently when conference creation fails). Workspace accounts always
get one. We surface `meet_url=""` when Google didn't mint one; the
operator UI can prompt the founder to attach a manual link.
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class ScheduleScreenInput(BaseModel):
    candidate_id: str
    start_iso: str = Field(..., description="ISO-8601 timestamp w/ tz offset for the slot start.")
    duration_minutes: int = Field(default=25, ge=10, le=120)
    round: str = Field(default="screen", description="interviews.round value to write. 'screen' for first call, 'onsite' for follow-ups.")
    title_override: Optional[str] = Field(default=None, max_length=160)
    description_override: Optional[str] = Field(default=None, max_length=2000)


class ScheduleScreenResult(BaseModel):
    interview_id: str
    candidate_id: str
    scheduled_at: str
    meet_url: str
    calendar_event_id: str
    calendar_html_link: str
    next_action: str
    mode: str  # "live" | "preview" | "failed"


GCAL_AUTH_CONFIG = "google_calendar"


def _has_gcal_auth(pod: Pod) -> bool:
    try:
        auth_configs = pod.connectors.auth_configs.list()
    except Exception:
        return False
    items = getattr(auth_configs, "items", None) or []
    return any(
        getattr(ac, "name", None) == GCAL_AUTH_CONFIG
        and getattr(ac, "connector_id", None) in ("google-calendar", "google_calendar")
        for ac in items
    )


def _parse_iso(value: str) -> datetime:
    """Accept ISO-8601 with or without a 'Z' suffix; require an offset."""
    s = value.strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        # Naive — assume UTC; caller should always send an offset.
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _to_dict(obj: Any) -> dict:
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "to_dict"):
        return obj.to_dict()
    return getattr(obj, "__dict__", {}) or {}


def _format_local(dt: datetime, tz_name: str) -> str:
    """Render a human label like 'Tue 9 Jul, 10:30 AM PT' for next_action."""
    try:
        from zoneinfo import ZoneInfo
        local = dt.astimezone(ZoneInfo(tz_name))
    except Exception:
        local = dt
    abbrev = local.tzname() or ""
    return local.strftime("%a %-d %b, %-I:%M %p ") + abbrev


# ---------------------------------------------------------------------------
# Response extraction — walk the Composio response tree
# ---------------------------------------------------------------------------

# Every alias any known Composio / Google build has used for the four fields
# we care about. Ordered so the most-authoritative shape wins if we hit
# multiple copies during the walk.
_EVENT_ID_KEYS = ("id", "event_id", "eventId")
_HTML_LINK_KEYS = ("htmlLink", "html_link", "event_url", "eventUrl", "eventLink")
_MEET_URL_KEYS = (
    "hangoutLink", "hangout_link",
    "meetLink", "meet_link", "meet_url", "meetUrl",
    "conferenceLink", "conference_link",
)
_START_KEYS = ("dateTime", "date_time", "start_datetime", "startDateTime", "date")


def _walk_dicts(root: Any):
    """Yield every dict node inside a nested structure, root first, DFS."""
    if isinstance(root, dict):
        yield root
        for v in root.values():
            yield from _walk_dicts(v)
    elif isinstance(root, list):
        for item in root:
            yield from _walk_dicts(item)


def _find_first(root: Any, keys: tuple[str, ...]) -> str:
    """Return the first non-empty string value found at any of `keys`
    anywhere in the response tree."""
    for node in _walk_dicts(root):
        for k in keys:
            v = node.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
            # Some builds surface these as objects with a `.value` field
            # (rare, but seen with Composio's "resource wrapper" shape).
            if isinstance(v, dict):
                iv = v.get("value") or v.get("uri") or v.get("url")
                if isinstance(iv, str) and iv.strip():
                    return iv.strip()
    return ""


def _find_meet_url_deep(root: Any) -> str:
    """Meet URL lookup is special: it can live at any of the flat aliases
    OR nested inside `conferenceData.entryPoints[?type==video].uri`.
    Try both shapes."""
    for node in _walk_dicts(root):
        # Direct flat aliases first.
        for k in _MEET_URL_KEYS:
            v = node.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
        # Google-native nested shape.
        conf = node.get("conferenceData") or node.get("conference_data")
        if isinstance(conf, dict):
            entry_points = conf.get("entryPoints") or conf.get("entry_points") or []
            if isinstance(entry_points, list):
                for ep in entry_points:
                    if not isinstance(ep, dict):
                        continue
                    et = ep.get("entryPointType") or ep.get("entry_point_type")
                    uri = ep.get("uri") or ep.get("url")
                    if et == "video" and isinstance(uri, str) and uri.strip():
                        return uri.strip()
        # Some Composio builds surface a bare `meeting` object.
        meeting = node.get("meeting") or node.get("meet")
        if isinstance(meeting, dict):
            for k in ("uri", "url", "link"):
                v = meeting.get(k)
                if isinstance(v, str) and v.strip():
                    return v.strip()
    return ""


def _find_start_iso(root: Any) -> str:
    """Start-time lookup: prefer a nested `start.{dateTime,date_time}`
    since that's the authoritative event field; fall back to any flat
    `start_datetime` variant."""
    for node in _walk_dicts(root):
        start_obj = node.get("start")
        if isinstance(start_obj, dict):
            for k in _START_KEYS:
                v = start_obj.get(k)
                if isinstance(v, str) and v.strip():
                    return v.strip()
    # Flat form.
    return _find_first(root, ("start_datetime", "startDateTime"))


def _extract_event_fields(envelope: Any) -> tuple[str, str, str, str]:
    """Return (event_id, html_link, meet_url, scheduled_at_iso) from any
    known Composio/Google response shape. Missing fields come back as ''."""
    event_id = _find_first(envelope, _EVENT_ID_KEYS)
    html_link = _find_first(envelope, _HTML_LINK_KEYS)
    meet_url = _find_meet_url_deep(envelope)
    scheduled_at_iso = _find_start_iso(envelope)
    return event_id, html_link, meet_url, scheduled_at_iso


def _build_event_payload(
    *,
    candidate_name: str,
    candidate_email: str,
    role_title: str,
    start: datetime,
    duration_minutes: int,
    timezone_name: str,
    title_override: Optional[str],
    description_override: Optional[str],
) -> dict:
    """Build the payload for Composio's `GOOGLECALENDAR_CREATE_EVENT`.

    The Composio shape is FLAT (not Google's native nested event body) —
    `start_datetime` is a tz-naive ISO string and `timezone` is a separate
    IANA name; duration is split into hour + minute (minute MUST be 0–59).
    `create_meeting_room=True` (default) is what mints the Meet link, no
    `conferenceData.createRequest` needed.
    """
    title = title_override or (
        f"{candidate_name} ↔ Hiremind · {role_title} screen" if role_title
        else f"{candidate_name} ↔ Hiremind · screen"
    )
    body_text = description_override or (
        f"Quick {duration_minutes}-minute screen with {candidate_name}.\n\n"
        f"Role: {role_title or 'TBD'}\n\n"
        "What we'll cover:\n"
        "  · One specific thing they've shipped\n"
        "  · What they're optimising for next\n"
        "  · Anything murky on the dossier\n\n"
        "Booked via Hiremind."
    )
    # Composio requires a tz-naive ISO string ("YYYY-MM-DDTHH:MM:SS") in
    # `start_datetime` and the IANA zone as a separate `timezone` field.
    # Strip any trailing offset/Z; Composio rejects them.
    start_local = start.strftime("%Y-%m-%dT%H:%M:%S")
    # Duration split: Composio caps `event_duration_minutes` at 59; full
    # hours go into `event_duration_hour`. So 25 min → (0, 25); 90 min →
    # (1, 30); 60 min → (1, 0).
    hours, minutes = divmod(max(1, duration_minutes), 60)
    return {
        "calendar_id": "primary",
        "summary": title,
        "description": body_text,
        "start_datetime": start_local,
        "timezone": timezone_name,
        "event_duration_hour": hours,
        "event_duration_minutes": minutes,
        # Composio accepts a list of plain email strings as the simplest
        # attendees shape. The organiser (founder) is added automatically
        # unless `exclude_organizer=True`.
        "attendees": [candidate_email],
        "send_updates": "all",
        "create_meeting_room": True,
        "transparency": "opaque",
        "visibility": "default",
    }


async def schedule_screen(
    ctx: FunctionContext,
    data: ScheduleScreenInput,
) -> ScheduleScreenResult:
    pod = Pod.from_env()

    candidate = _to_dict(pod.records.get("candidates", data.candidate_id))
    if not candidate:
        raise ValueError(f"Candidate {data.candidate_id} not found.")
    candidate_email = candidate.get("email") or ""
    candidate_name = candidate.get("name") or "candidate"
    if not candidate_email:
        raise ValueError(
            f"Candidate {candidate_name} has no email on file — can't send a calendar invite. "
            "Add their email to the candidate record first, then re-run scheduling."
        )

    role_title = ""
    role_id = candidate.get("role_id")
    if role_id:
        try:
            role_row = _to_dict(pod.records.get("roles", role_id))
            role_title = role_row.get("title") or ""
        except Exception:
            role_title = ""

    try:
        start = _parse_iso(data.start_iso)
    except Exception as exc:
        raise ValueError(f"Could not parse start_iso '{data.start_iso}': {exc!s}")
    timezone_name = start.tzinfo.tzname(start) if start.tzinfo else "UTC"
    # Prefer a stable IANA name. tzname() may return "PDT" etc which Google
    # rejects — if it's not an IANA-shaped string we fall back to UTC offset
    # ("Etc/GMT-7" for -07:00). Most callers will pass an offset like
    # +00:00 anyway since slots come from propose_slots.
    if not (timezone_name and "/" in timezone_name):
        # Compute an Etc/GMT name from the offset. Note: Etc/GMT signs are
        # inverted from POSIX convention (+ means west of GMT).
        offset = start.utcoffset() or timedelta(0)
        hours = -int(offset.total_seconds() // 3600)
        timezone_name = f"Etc/GMT{hours:+d}"

    if not _has_gcal_auth(pod):
        # Surface this as a structured "preview" — the operator UI can show
        # a "Connect Google Calendar" prompt, exactly mirroring how
        # send_outreach behaves when the gmail connector is missing.
        # We DON'T persist a half-formed interview row here; nothing
        # downstream should think we successfully scheduled.
        raise RuntimeError(
            f"No '{GCAL_AUTH_CONFIG}' auth config wired for the google-calendar connector. "
            "Connect Google Calendar in the integrations panel and retry."
        )

    event_payload = _build_event_payload(
        candidate_name=candidate_name,
        candidate_email=candidate_email,
        role_title=role_title,
        start=start,
        duration_minutes=data.duration_minutes,
        timezone_name=timezone_name,
        title_override=data.title_override,
        description_override=data.description_override,
    )

    try:
        result = pod.connectors.execute(
            GCAL_AUTH_CONFIG,
            "GOOGLECALENDAR_CREATE_EVENT",
            event_payload,
        )
    except Exception as exc:
        raise RuntimeError(f"Calendar event creation failed: {exc!s}")

    # ------------------------------------------------------------------
    # Composio response parsing.
    #
    # Composio's `GOOGLECALENDAR_CREATE_EVENT` envelope has moved shapes
    # multiple times: old builds returned the raw Google event; current
    # builds wrap it as `{data: {response_data: {...google event...}},
    # successful: bool, error: str}`; some SDK versions expose only a
    # flattened form (`event_id`, `event_url`, `meet_link`). To stop
    # chasing this every release, we walk the ENTIRE response tree
    # looking for the fields we need. This is O(fields × nodes) but the
    # response is tiny, so it's fine.
    # ------------------------------------------------------------------
    envelope_root = _to_dict(result)
    if not envelope_root:
        envelope_root = _to_dict(
            getattr(result, "result", None) or getattr(result, "data", None) or result
        )

    # `successful` / `error` may live at the top or one level down —
    # check both.
    if envelope_root.get("successful") is False or envelope_root.get("error"):
        raise RuntimeError(
            f"Calendar event creation failed: {envelope_root.get('error') or 'unknown Composio error'}"
        )
    inner = envelope_root.get("data")
    if isinstance(inner, dict):
        if inner.get("successful") is False or inner.get("error"):
            raise RuntimeError(
                f"Calendar event creation failed: {inner.get('error') or 'unknown Composio error'}"
            )

    event_id, html_link, meet_url, scheduled_at_iso = _extract_event_fields(envelope_root)

    # If we successfully created something but couldn't find *any* of
    # the expected fields, the response shape has changed again —
    # surface a debug-friendly error rather than silently persisting
    # a half-empty row. The error message includes the top-level keys
    # so future debugging is one grep away.
    if not (event_id or meet_url or html_link):
        top_keys = ", ".join(sorted(envelope_root.keys())) or "(empty)"
        inner_keys = ""
        if isinstance(inner, dict):
            inner_keys = ", ".join(sorted(inner.keys()))
        raise RuntimeError(
            "Calendar event created but Composio response was missing event id / meet url / html link. "
            f"Top-level keys: [{top_keys}]. Inner data keys: [{inner_keys}]. "
            "This usually means the connected Google account is a personal (@gmail.com) account without "
            "Workspace Meet — Composio silently drops conference creation there. Try connecting a "
            "Google Workspace account, or add a Meet link manually to the interview row."
        )

    if not scheduled_at_iso:
        scheduled_at_iso = start.isoformat()

    interview_payload: dict[str, Any] = {
        "candidate_id": candidate["id"],
        "round": data.round,
        "status": "scheduled",
        "scheduled_at": scheduled_at_iso,
        "interviewer_email": "",  # filled in later if a panelist is added
    }
    if meet_url:
        interview_payload["meet_url"] = meet_url
    if event_id:
        interview_payload["calendar_event_id"] = event_id

    created = pod.table("interviews").create(interview_payload)
    interview_id = str(created["id"]) if isinstance(created, dict) else str(getattr(created, "id"))

    # Candidate row update — show the booked time in next_action so the
    # kanban card reflects the actual scheduled state. We do NOT
    # auto-advance stage: founder marks "Screen complete" themselves
    # after the call.
    label = _format_local(start, candidate.get("source_meta", {}).get("timezone", "America/Los_Angeles") if isinstance(candidate.get("source_meta"), dict) else "America/Los_Angeles")
    next_action = f"Screen booked · {label}" + (f" · Meet: {meet_url}" if meet_url else "")
    try:
        pod.table("candidates").update(candidate["id"], {
            "next_action": next_action,
            "last_contact": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        # Non-fatal — the event + interview row are real, the card label
        # just won't reflect it. Better to return success than blow up.
        pass

    return ScheduleScreenResult(
        interview_id=interview_id,
        candidate_id=str(candidate["id"]),
        scheduled_at=scheduled_at_iso,
        meet_url=meet_url,
        calendar_event_id=event_id,
        calendar_html_link=html_link,
        next_action=next_action,
        mode="live",
    )
