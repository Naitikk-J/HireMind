#input_type_name: DiscordBroadcastInput
#output_type_name: DiscordBroadcastResult
#function_name: discord_broadcast

"""
Broadcast a sourcing message to a Discord channel.

The founder tells us:
  - which channel (a Discord channel_id in a server they're in),
  - which role they're hiring for (or free-text body),
  - and we post an announcement using the Discord connector.

We keep this function narrow: it does not enumerate members or DM
individuals. Discord's ToS + rate limits make cold DMs a bad idea. But
posting to a community channel where the founder is already trusted is
the highest-signal sourcing channel most technical founders have — and
Hiremind should make it one tap.

The message body is composed from the role's pitch.md (if role_id is
given) with a short standard preamble. Falls back to `body_override`
when the founder wants full control.

We persist the sent message to the `messages` table so it shows up in
the operator app's outbound history.
"""

from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class DiscordBroadcastInput(BaseModel):
    channel_id: str = Field(..., description="Discord channel ID (numeric string, 17-20 digits).")
    role_id: Optional[str] = Field(default=None, description="Roles table row to source from — for embedding pitch line + title.")
    body_override: Optional[str] = Field(default=None, description="Explicit message body. If set, role_id is used only for tagging.")
    tag_everyone: bool = Field(default=False, description="Prepend '@here' — use sparingly, spammy in most servers.")


class DiscordBroadcastResult(BaseModel):
    channel_id: str
    message_id: str
    body: str
    posted_at: str
    message_row_id: str
    mode: str  # "live" | "connector_missing" | "failed"


DISCORD_AUTH_CONFIG = "discord"


def _to_dict(obj: Any) -> dict:
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "to_dict"):
        return obj.to_dict()
    return getattr(obj, "__dict__", {}) or {}


def _has_discord_auth(pod: Pod) -> bool:
    try:
        auth_configs = pod.connectors.auth_configs.list()
    except Exception:
        return False
    items = getattr(auth_configs, "items", None) or []
    return any(getattr(ac, "name", None) == DISCORD_AUTH_CONFIG for ac in items)


def _safe_read_text(pod: Pod, path: str) -> str:
    try:
        blob = pod.files.download(path)
        return blob.decode("utf-8", errors="replace") if blob else ""
    except Exception:
        return ""


def _extract_pitch_line(pitch_md: str) -> str:
    if not pitch_md:
        return ""
    for line in pitch_md.splitlines():
        s = line.strip()
        if s.startswith("*\"") and s.endswith("\"*"):
            return s.strip("*").strip("\"")
        if s.startswith("\"") and s.endswith("\""):
            return s.strip("\"")
    for line in pitch_md.splitlines():
        s = line.strip()
        if s and not s.startswith("#") and not s.startswith("-") and not s.startswith("*"):
            return s
    return ""


def _extract_composio_data(result: Any) -> dict:
    envelope = _to_dict(getattr(result, "result", None) or getattr(result, "data", None) or result)
    if not envelope:
        envelope = _to_dict(result)
    if envelope.get("successful") is False or envelope.get("error"):
        raise RuntimeError(f"Discord API call failed: {envelope.get('error') or 'unknown'}")
    data = envelope.get("data")
    return data if isinstance(data, dict) else envelope


def _compose_body(role_title: str, pitch_line: str, tag_everyone: bool) -> str:
    header = "**Hiring — no recruiters, no bullshit.**"
    if tag_everyone:
        header = "@here " + header
    bits = [header]
    if role_title:
        bits.append(f"Role: **{role_title}** · founding team.")
    if pitch_line:
        bits.append(pitch_line)
    bits.append(
        "If you're interested (or know someone who is), reply here or DM me — "
        "I'll get back within a day with a real conversation, not a phone screen."
    )
    return "\n\n".join(bits)


async def discord_broadcast(ctx: FunctionContext, data: DiscordBroadcastInput) -> DiscordBroadcastResult:
    pod = Pod.from_env()

    role_title = ""
    pitch_line = ""
    if data.role_id:
        try:
            role_row = _to_dict(pod.records.get("roles", data.role_id))
            role_title = str(role_row.get("title") or "")
            role_slug = str(role_row.get("slug") or "")
            if role_slug:
                pitch_md = _safe_read_text(pod, f"/knowledge/roles/{role_slug}/pitch.md")
                pitch_line = _extract_pitch_line(pitch_md)
        except Exception:
            pass

    body = data.body_override.strip() if data.body_override else _compose_body(
        role_title=role_title, pitch_line=pitch_line, tag_everyone=data.tag_everyone
    )

    if not _has_discord_auth(pod):
        raise RuntimeError(
            f"No '{DISCORD_AUTH_CONFIG}' auth config wired for the Discord connector. "
            "Connect Discord in the integrations panel and retry."
        )

    try:
        raw = pod.connectors.execute(
            DISCORD_AUTH_CONFIG,
            "DISCORD_CREATE_MESSAGE",
            {"channel_id": data.channel_id, "content": body},
        )
        posted = _extract_composio_data(raw)
    except Exception as exc:
        raise RuntimeError(f"Discord broadcast failed: {exc!s}")

    message_id = str(posted.get("id") or "")
    posted_at = str(posted.get("timestamp") or datetime.now(timezone.utc).isoformat())

    # Persist the outbound row for audit + operator visibility.
    row_id = ""
    try:
        created = pod.table("messages").create(
            {
                "candidate_id": "",
                "direction": "outbound",
                "channel": "discord",
                "status": "sent",
                "subject": f"Discord broadcast → channel {data.channel_id}",
                "body": body,
                "sent_at": posted_at,
                "external_id": message_id,
            }
        )
        row_id = str(created["id"]) if isinstance(created, dict) else str(getattr(created, "id"))
    except Exception:
        row_id = ""

    return DiscordBroadcastResult(
        channel_id=data.channel_id,
        message_id=message_id,
        body=body,
        posted_at=posted_at,
        message_row_id=row_id,
        mode="live",
    )
