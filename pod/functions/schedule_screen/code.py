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

    # Composio response envelope: `{ "data": <google event json>,
    # "successful": bool, "error": str | None }`. Older SDK builds may
    # surface the body under `.result` or `.data`; we accept either.
    envelope = _to_dict(getattr(result, "result", None) or getattr(result, "data", None) or result)
    if not envelope:
        envelope = _to_dict(result)
    if envelope.get("successful") is False or envelope.get("error"):
        raise RuntimeError(
            f"Calendar event creation failed: {envelope.get('error') or 'unknown Composio error'}"
        )
    event = envelope.get("data") if isinstance(envelope.get("data"), dict) else envelope
    if not isinstance(event, dict):
        event = {}

    event_id = str(event.get("id") or "")
    html_link = str(event.get("htmlLink") or event.get("html_link") or "")
    # Meet URL lives at conferenceData.entryPoints[?type==video].uri in
    # Google's native event shape. Composio passes the event through
    # unchanged when conference creation succeeds. Fall back to
    # hangoutLink (Google sometimes mirrors it there) and finally to a
    # flat `meet_link` that some Composio versions surface.
    meet_url = ""
    conf = event.get("conferenceData") or event.get("conference_data") or {}
    for ep in (conf.get("entryPoints") or conf.get("entry_points") or []):
        et = ep.get("entryPointType") or ep.get("entry_point_type")
        uri = ep.get("uri") or ep.get("url")
        if et == "video" and uri:
            meet_url = uri
            break
    if not meet_url:
        meet_url = event.get("hangoutLink") or event.get("hangout_link") or event.get("meet_link") or ""

    # Persist the interview row. We use the verified scheduled time
    # (from the event) when possible, else the requested start.
    # Composio may flatten start to `start_datetime` or pass through
    # the native nested `start.dateTime` shape; accept either.
    scheduled_at_iso = ""
    es = event.get("start") or {}
    if isinstance(es, dict):
        scheduled_at_iso = es.get("dateTime") or es.get("date_time") or es.get("date") or ""
    if not scheduled_at_iso:
        scheduled_at_iso = str(event.get("start_datetime") or event.get("startDateTime") or "")
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
