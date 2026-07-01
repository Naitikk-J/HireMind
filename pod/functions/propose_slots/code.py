#input_type_name: ProposeSlotsInput
#output_type_name: ProposeSlotsResult
#function_name: propose_slots

"""
Free-busy-aware slot proposer.

Most cold-outreach emails die at the "...happy to chat sometime next week?"
line because the candidate has to draft a reply, propose times, and wait
for the founder to counter-propose. We can collapse that round-trip by
*proposing 3 specific slots* up front — the candidate picks one, replies
with the choice, and the founder confirms.

The honest version requires the founder's actual calendar, otherwise we'd
propose slots they're already in meetings for and look amateur. We talk
to Google Calendar via the `google-calendar` connector and ask its
`freebusy.query` endpoint for the next 7 days. From the BUSY blocks we
compute three FREE 25-minute slots inside business hours (09:00-18:00 in
the founder's timezone) on weekdays.

Graceful degradation:
  - If no `google_calendar` auth config is registered → return a static
    "tomorrow / day-after / day-after-that at 10:30 AM" fallback. The
    candidate still gets concrete slots; the founder edits before sending.
  - If the API call errors → same fallback, but the `source` field on the
    output flips to `"fallback_after_error"` so draft_outreach can flag it
    in voice_check.
"""

import re
from datetime import datetime, timedelta, timezone, time as dtime
from typing import Any, Optional
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class ProposeSlotsInput(BaseModel):
    """All fields are optional — defaults give a useful answer for the
    common case (founder in a US timezone, 25-min screens, next 7 days)."""
    timezone: str = Field(default="America/Los_Angeles", description="IANA tz, e.g. 'America/New_York'.")
    duration_minutes: int = Field(default=25, ge=10, le=120)
    horizon_days: int = Field(default=7, ge=1, le=21)
    slots_wanted: int = Field(default=3, ge=1, le=6)
    business_hours_start: int = Field(default=9, ge=0, le=23, description="Hour of day (0-23) free-busy search begins.")
    business_hours_end: int = Field(default=18, ge=1, le=24)
    # Slot granularity. 30 min = on the half hour; 15 = quarter hour. Smaller
    # values yield more candidate slots but feel "too specific" in a cold
    # email — half-hour reads as human-scheduled.
    grid_minutes: int = Field(default=30, ge=15, le=60)


class ProposedSlot(BaseModel):
    start: str  # ISO-8601 with tz offset
    end: str
    label: str  # human-friendly, founder's tz: "Tue 9 Jul, 10:30 AM PT"


class ProposeSlotsResult(BaseModel):
    slots: list[ProposedSlot]
    source: str  # "calendar" | "fallback_no_auth" | "fallback_after_error" | "fallback_no_freebusy_data"
    timezone: str
    note: str = ""  # human-readable explanation, surfaced in voice_check


GCAL_AUTH_CONFIG = "google_calendar"


def _founder_tz(tz_name: str) -> ZoneInfo:
    try:
        return ZoneInfo(tz_name)
    except Exception:
        # Bad tz arg — fall back to a sane default rather than 500.
        return ZoneInfo("America/Los_Angeles")


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


def _format_label(slot_start: datetime) -> str:
    """Render a slot for inline use in an email body.

    Format: 'Tue 9 Jul, 10:30 AM PT' — short, unambiguous, copies cleanly.
    The tz suffix is the abbreviation the zoneinfo library reports for
    that date (handles DST automatically — 'PT' will be 'PDT' in summer).
    """
    tz_abbrev = slot_start.tzname() or ""
    # strftime("%-I") is GNU; on macOS/Linux it's supported. On Windows it
    # would barf — Lemma runs on Linux containers, so we're fine.
    return slot_start.strftime("%a %-d %b, %-I:%M %p ") + tz_abbrev


def _generate_grid(
    tz: ZoneInfo,
    *,
    horizon_days: int,
    business_start: int,
    business_end: int,
    duration: timedelta,
    grid: timedelta,
) -> list[datetime]:
    """Generate every candidate slot start time in the next `horizon_days`,
    on weekdays, inside business hours, aligned to the `grid` granularity."""
    now = datetime.now(tz)
    # Start from the next grid tick after now + 2 hours (no same-hour
    # surprise meetings).
    cursor = now + timedelta(hours=2)
    cursor = cursor.replace(second=0, microsecond=0)
    # Round up to next grid boundary.
    grid_min = grid.total_seconds() / 60
    minutes_past = cursor.minute % grid_min
    if minutes_past:
        cursor += timedelta(minutes=(grid_min - minutes_past))

    end_horizon = now + timedelta(days=horizon_days)
    slots: list[datetime] = []
    step = grid
    while cursor < end_horizon:
        # Skip weekends.
        if cursor.weekday() >= 5:
            cursor += step
            continue
        # Skip outside business hours. We compare against a candidate
        # business hour for the candidate's local date.
        if cursor.hour < business_start:
            cursor = cursor.replace(hour=business_start, minute=0)
            continue
        # The slot has to END inside business hours, not just start.
        slot_end = cursor + duration
        if slot_end.hour > business_end or (slot_end.hour == business_end and slot_end.minute > 0):
            # Move to next day at business_start.
            next_day = (cursor + timedelta(days=1)).replace(hour=business_start, minute=0)
            cursor = next_day
            continue
        slots.append(cursor)
        cursor += step
    return slots


def _parse_busy_intervals(freebusy_resp: Any, calendar_id: str) -> list[tuple[datetime, datetime]]:
    """Pull (start, end) UTC intervals out of a Composio FIND_FREE_SLOTS
    response.

    Composio envelope: ``{"data": <inner>, "successful": bool, "error": str?}``
    where ``<inner>`` is a thin wrapper around Google's native free-busy
    response:
      { "calendars": { "<cal-id>": { "busy": [ {"start": ISO, "end": ISO}, ... ] } } }
    Composio sometimes also flattens this to a top-level ``busy`` array on
    ``data`` itself when only one calendar was queried. We accept either.
    """
    if hasattr(freebusy_resp, "to_dict"):
        envelope = freebusy_resp.to_dict()
    elif isinstance(freebusy_resp, dict):
        envelope = freebusy_resp
    else:
        envelope = getattr(freebusy_resp, "result", None) or getattr(freebusy_resp, "data", None) or {}
        if hasattr(envelope, "to_dict"):
            envelope = envelope.to_dict()
        if not isinstance(envelope, dict):
            envelope = getattr(envelope, "__dict__", {}) or {}

    # If we still have the Composio envelope, peel it to its `data` body.
    inner = envelope
    if isinstance(envelope.get("data"), dict):
        inner = envelope["data"]

    busy_raw: list = []
    calendars = inner.get("calendars") if isinstance(inner.get("calendars"), dict) else None
    if calendars:
        cal_block = calendars.get(calendar_id) or calendars.get("primary") or {}
        busy_raw = cal_block.get("busy") or []
    elif isinstance(inner.get("busy"), list):
        # Composio's flattened single-calendar shape.
        busy_raw = inner["busy"]

    intervals: list[tuple[datetime, datetime]] = []
    for b in busy_raw:
        try:
            start = datetime.fromisoformat(str(b["start"]).replace("Z", "+00:00"))
            end = datetime.fromisoformat(str(b["end"]).replace("Z", "+00:00"))
            intervals.append((start, end))
        except Exception:
            continue
    return intervals


def _slot_is_free(slot_start: datetime, duration: timedelta, busy: list[tuple[datetime, datetime]]) -> bool:
    slot_end = slot_start + duration
    slot_start_utc = slot_start.astimezone(timezone.utc)
    slot_end_utc = slot_end.astimezone(timezone.utc)
    for (b_start, b_end) in busy:
        # Overlap test: NOT (slot_end <= b_start OR slot_start >= b_end)
        if not (slot_end_utc <= b_start or slot_start_utc >= b_end):
            return False
    return True


def _fallback_slots(
    tz: ZoneInfo,
    *,
    duration: timedelta,
    n: int,
) -> list[ProposedSlot]:
    """Static-but-sensible slots used whenever the calendar isn't available.

    Next `n` weekday mornings starting tomorrow, at 10:30 AM local time —
    a sweet spot that misses most coast-to-coast meeting conflicts.
    """
    now = datetime.now(tz)
    out: list[ProposedSlot] = []
    cursor = now.replace(hour=10, minute=30, second=0, microsecond=0)
    # Always start tomorrow.
    cursor += timedelta(days=1)
    safety = 0
    while len(out) < n and safety < 30:
        safety += 1
        if cursor.weekday() < 5:
            slot_end = cursor + duration
            out.append(ProposedSlot(
                start=cursor.isoformat(),
                end=slot_end.isoformat(),
                label=_format_label(cursor),
            ))
        cursor += timedelta(days=1)
    return out


async def propose_slots(
    ctx: FunctionContext,
    data: ProposeSlotsInput,
) -> ProposeSlotsResult:
    tz = _founder_tz(data.timezone)
    duration = timedelta(minutes=data.duration_minutes)
    grid = timedelta(minutes=data.grid_minutes)

    pod = Pod.from_env()

    if not _has_gcal_auth(pod):
        slots = _fallback_slots(tz, duration=duration, n=data.slots_wanted)
        return ProposeSlotsResult(
            slots=slots,
            source="fallback_no_auth",
            timezone=data.timezone,
            note=f"No '{GCAL_AUTH_CONFIG}' auth config wired — using deterministic weekday-morning slots. Connect Google Calendar to make these reflect actual free-busy.",
        )

    # Free-busy window: [now, now+horizon_days]. Composio's
    # `GOOGLECALENDAR_FIND_FREE_SLOTS` takes a FLAT payload with tz-naive
    # ISO strings + a separate `timezone` field, NOT Google's native
    # nested freebusy.query body.
    now_utc = datetime.now(timezone.utc)
    horizon_utc = now_utc + timedelta(days=data.horizon_days)
    freebusy_payload = {
        "items": ["primary"],
        "time_min": now_utc.strftime("%Y-%m-%dT%H:%M:%S"),
        "time_max": horizon_utc.strftime("%Y-%m-%dT%H:%M:%S"),
        "timezone": data.timezone,
    }

    try:
        resp = pod.connectors.execute(
            GCAL_AUTH_CONFIG,
            "GOOGLECALENDAR_FIND_FREE_SLOTS",
            freebusy_payload,
        )
    except Exception as exc:
        slots = _fallback_slots(tz, duration=duration, n=data.slots_wanted)
        return ProposeSlotsResult(
            slots=slots,
            source="fallback_after_error",
            timezone=data.timezone,
            note=f"Free-busy query failed ({exc!s}) — using deterministic fallback. The connector may need a re-auth.",
        )

    busy = _parse_busy_intervals(resp, calendar_id="primary")
    grid_slots = _generate_grid(
        tz,
        horizon_days=data.horizon_days,
        business_start=data.business_hours_start,
        business_end=data.business_hours_end,
        duration=duration,
        grid=grid,
    )
    if not grid_slots:
        slots = _fallback_slots(tz, duration=duration, n=data.slots_wanted)
        return ProposeSlotsResult(
            slots=slots,
            source="fallback_no_freebusy_data",
            timezone=data.timezone,
            note="No business-hour candidate slots in the window (off-hours horizon?) — fell back.",
        )

    free_picked: list[datetime] = []
    seen_days: set[str] = set()
    for slot_start in grid_slots:
        if not _slot_is_free(slot_start, duration, busy):
            continue
        # Limit to one slot per day so the proposal feels human (3 days, not
        # 3 back-to-back morning slots on the same Wednesday).
        day_key = slot_start.strftime("%Y-%m-%d")
        if day_key in seen_days:
            continue
        seen_days.add(day_key)
        free_picked.append(slot_start)
        if len(free_picked) >= data.slots_wanted:
            break

    if not free_picked:
        slots = _fallback_slots(tz, duration=duration, n=data.slots_wanted)
        return ProposeSlotsResult(
            slots=slots,
            source="fallback_no_freebusy_data",
            timezone=data.timezone,
            note="Calendar was solid back-to-back over the horizon — used deterministic fallback so outreach still shows real options.",
        )

    proposed = [
        ProposedSlot(
            start=s.isoformat(),
            end=(s + duration).isoformat(),
            label=_format_label(s),
        )
        for s in free_picked
    ]
    return ProposeSlotsResult(
        slots=proposed,
        source="calendar",
        timezone=data.timezone,
        note=f"Pulled from Google Calendar free-busy ({len(busy)} busy intervals reviewed).",
    )
