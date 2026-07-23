#input_type_name: IngestDriveResumeInput
#output_type_name: IngestDriveResumeResult
#function_name: ingest_drive_resume

"""
Ingest a candidate resume from Google Drive.

The founder pastes a Drive link (or file_id) into the operator app. We:

  1. Parse the file_id out of common Drive URL shapes.
  2. Fetch metadata via `GOOGLEDRIVE_GET_FILE_METADATA` to know the
     mimeType, name, and size.
  3. Download the file bytes via `GOOGLEDRIVE_DOWNLOAD_FILE` (or export
     to PDF for Google-native docs).
  4. Save into the pod's own file store under
     `/candidates/<candidate_id>/resume.<ext>`.
  5. Update `candidate.resume_path` and (best-effort) return a
     short text preview from the file bytes for the operator UI.

If the file is a Google Doc (native), we ask Drive to export it as PDF
so downstream tooling doesn't have to know about Google's proprietary
format.
"""

import re
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class IngestDriveResumeInput(BaseModel):
    candidate_id: str
    drive_url_or_id: str = Field(..., description="Full Drive share URL OR the raw file_id.")
    filename_hint: Optional[str] = Field(default=None, description="Override for the saved filename stem. If missing, we use 'resume'.")


class IngestDriveResumeResult(BaseModel):
    candidate_id: str
    file_id: str
    saved_path: str
    mime_type: str
    size_bytes: int
    preview: str
    mode: str  # "live" | "connector_missing" | "not_found" | "failed"


DRIVE_AUTH_CONFIG = "google_drive"

_DRIVE_ID_PATTERNS = [
    re.compile(r"/d/([a-zA-Z0-9_\-]{20,})"),
    re.compile(r"id=([a-zA-Z0-9_\-]{20,})"),
    re.compile(r"file/d/([a-zA-Z0-9_\-]{20,})"),
]


def _to_dict(obj: Any) -> dict:
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "to_dict"):
        return obj.to_dict()
    return getattr(obj, "__dict__", {}) or {}


def _has_drive_auth(pod: Pod) -> bool:
    try:
        auth_configs = pod.connectors.auth_configs.list()
    except Exception:
        return False
    items = getattr(auth_configs, "items", None) or []
    return any(getattr(ac, "name", None) == DRIVE_AUTH_CONFIG for ac in items)


def _parse_file_id(raw: str) -> str:
    raw = raw.strip()
    if not raw:
        return ""
    # If it's already a bare id, return it.
    if re.fullmatch(r"[a-zA-Z0-9_\-]{20,}", raw):
        return raw
    for pat in _DRIVE_ID_PATTERNS:
        m = pat.search(raw)
        if m:
            return m.group(1)
    return ""


def _extract_composio_data(result: Any) -> dict:
    envelope = _to_dict(getattr(result, "result", None) or getattr(result, "data", None) or result)
    if not envelope:
        envelope = _to_dict(result)
    if envelope.get("successful") is False or envelope.get("error"):
        raise RuntimeError(f"Drive API call failed: {envelope.get('error') or 'unknown'}")
    data = envelope.get("data")
    return data if isinstance(data, dict) else envelope


_MIME_EXT = {
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.google-apps.document": "pdf",  # exported
    "text/plain": "txt",
    "text/markdown": "md",
    "text/html": "html",
    "application/rtf": "rtf",
}


def _decode_file_bytes(payload: dict) -> bytes:
    """Composio's DOWNLOAD_FILE returns bytes in one of a few shapes.
    Handle both raw string + base64 envelopes gracefully.
    """
    import base64
    for key in ("file", "file_content", "content", "bytes"):
        v = payload.get(key)
        if isinstance(v, (bytes, bytearray)):
            return bytes(v)
        if isinstance(v, str) and v:
            try:
                return base64.b64decode(v, validate=False)
            except Exception:
                return v.encode("utf-8", errors="replace")
    return b""


def _text_preview(blob: bytes, mime_type: str, limit: int = 800) -> str:
    """Best-effort text preview — good enough for the UI to show 'this
    is the right file' without reading the raw PDF."""
    if not blob:
        return ""
    if mime_type.startswith("text/") or mime_type in ("application/json", "application/rtf"):
        try:
            return blob[: limit * 4].decode("utf-8", errors="replace")[:limit]
        except Exception:
            return ""
    # For PDF/docx we don't extract inline — surface the mimetype only.
    return ""


async def ingest_drive_resume(ctx: FunctionContext, data: IngestDriveResumeInput) -> IngestDriveResumeResult:
    pod = Pod.from_env()

    candidate = _to_dict(pod.records.get("candidates", data.candidate_id))
    if not candidate:
        raise ValueError(f"Candidate {data.candidate_id} not found.")

    file_id = _parse_file_id(data.drive_url_or_id)
    if not file_id:
        return IngestDriveResumeResult(
            candidate_id=data.candidate_id,
            file_id="",
            saved_path="",
            mime_type="",
            size_bytes=0,
            preview="",
            mode="not_found",
        )

    if not _has_drive_auth(pod):
        raise RuntimeError(
            f"No '{DRIVE_AUTH_CONFIG}' auth config wired for the Google Drive connector. "
            "Connect Google Drive in the integrations panel and retry."
        )

    try:
        meta_raw = pod.connectors.execute(
            DRIVE_AUTH_CONFIG,
            "GOOGLEDRIVE_GET_FILE_METADATA",
            {"file_id": file_id, "fields": "id,name,mimeType,size,modifiedTime"},
        )
        meta = _extract_composio_data(meta_raw)
    except Exception as exc:
        raise RuntimeError(f"Drive metadata fetch failed: {exc!s}")

    mime_type = str(meta.get("mimeType") or meta.get("mime_type") or "")
    original_name = str(meta.get("name") or "resume")

    # For Google-native docs we must ask Drive to export.
    export_mime: Optional[str] = None
    if mime_type == "application/vnd.google-apps.document":
        export_mime = "application/pdf"
    elif mime_type == "application/vnd.google-apps.spreadsheet":
        export_mime = "application/pdf"

    try:
        payload: dict[str, Any] = {"file_id": file_id}
        if export_mime:
            payload["mime_type"] = export_mime
        download_raw = pod.connectors.execute(
            DRIVE_AUTH_CONFIG,
            "GOOGLEDRIVE_DOWNLOAD_FILE",
            payload,
        )
        download = _extract_composio_data(download_raw)
    except Exception as exc:
        raise RuntimeError(f"Drive file download failed: {exc!s}")

    blob = _decode_file_bytes(download)
    if not blob:
        raise RuntimeError("Drive returned an empty file — check that the resume is shared with the connected account.")

    effective_mime = export_mime or mime_type
    ext = _MIME_EXT.get(effective_mime, "")
    if not ext:
        # Fall back to original filename extension if we recognise it.
        dot = original_name.rfind(".")
        if dot > 0 and dot < len(original_name) - 1:
            ext = original_name[dot + 1:].lower()[:6] or "bin"
        else:
            ext = "bin"

    stem = (data.filename_hint or "resume").strip() or "resume"
    saved_path = f"/candidates/{data.candidate_id}/{stem}.{ext}"

    try:
        pod.files.upload(saved_path, blob)
    except Exception as exc:
        raise RuntimeError(f"Saving resume into pod file store failed: {exc!s}")

    try:
        pod.records.update(
            "candidates",
            data.candidate_id,
            {
                "resume_path": saved_path,
                "resume_source": "google_drive",
                "resume_ingested_at": datetime.now(timezone.utc).isoformat(),
            },
        )
    except Exception:
        pass

    return IngestDriveResumeResult(
        candidate_id=data.candidate_id,
        file_id=file_id,
        saved_path=saved_path,
        mime_type=effective_mime,
        size_bytes=len(blob),
        preview=_text_preview(blob, effective_mime),
        mode="live",
    )
