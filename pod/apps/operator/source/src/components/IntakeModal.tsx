import { useEffect, useState } from "react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { getClient } from "@/lib/client";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/types";

/**
 * Single source of truth for the "drop anything, AI triages it" intake flow.
 *
 * Two entry points feed into this:
 *   1. Pipeline's "+ New candidate" button → no preset role, parser auto-detects
 *   2. Roles tab's per-role "Add candidate" → role preset, parser scores
 *      against that specific role
 *
 * Both pass through the `intake` workflow → `parse_intake` → `create_candidate`
 * → `triage_and_notify`. The only difference is whether `role_slug` is set
 * on the form payload; everything downstream is unchanged.
 */
export function IntakeModal({
  open,
  onClose,
  onCreated,
  presetRoleSlug,
  presetRoleTitle,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
  /** When provided, the picker is locked to this role and `parse_intake`
   *  scores against it instead of auto-detecting. */
  presetRoleSlug?: string;
  /** Display label for the locked role (avoids a round-trip to look it up). */
  presetRoleTitle?: string;
}) {
  const [raw, setRaw] = useState("");
  const [roleSlug, setRoleSlug] = useState<string>(presetRoleSlug || "");
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [parsingFile, setParsingFile] = useState<string | null>(null);
  const [droppedFiles, setDroppedFiles] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!open) {
      setRaw("");
      setErr(null);
      setBusy(false);
      setDroppedFiles([]);
      setParsingFile(null);
      setDragOver(false);
      setRoleSlug(presetRoleSlug || "");
      return;
    }
    if (presetRoleSlug) {
      setRoleSlug(presetRoleSlug);
      return;
    }
    // Only fetch the role list when we'll actually show the picker (i.e. not
    // locked to a preset). Cheap, but no reason to bill it.
    (async () => {
      try {
        const client = await getClient();
        const list = await client.records.list<Role>("roles", { limit: 100 });
        setRoles(list.items.filter((r) => r.status === "open"));
      } catch {
        setRoles([]);
      }
    })();
  }, [open, presetRoleSlug]);

  async function ingestFiles(files: FileList | File[]) {
    setErr(null);
    const list = Array.from(files);
    for (const file of list) {
      setParsingFile(file.name);
      try {
        const text = await extractTextFromFile(file);
        if (text.trim()) {
          setRaw((prev) =>
            prev ? `${prev}\n\n--- ${file.name} ---\n${text}` : `--- ${file.name} ---\n${text}`,
          );
          setDroppedFiles((p) => [...p, file.name]);
        } else {
          setErr(`${file.name}: no text extracted (encrypted PDF or image-only?). Try pasting manually.`);
        }
      } catch (e) {
        setErr(`${file.name}: ${e instanceof Error ? e.message : "couldn't read this file"}`);
      } finally {
        setParsingFile(null);
      }
    }
  }

  async function submit() {
    if (!raw.trim()) {
      setErr("Drop a resume, paste a URL, or type a note — anything works.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const client = await getClient();
      const payload: Record<string, unknown> = { raw, channel_hint: "manual" };
      if (roleSlug) payload.role_slug = roleSlug;
      await client.workflows.run("intake", { data: payload });
      await onCreated();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const subtitle = presetRoleTitle
    ? `Triage against ${presetRoleTitle}. The score, dossier, and email verdict will all be tied to this role.`
    : "Resume PDF, LinkedIn URL, referral note, voice-note transcript. The triage agent decides if they're worth a closer look and emails you the verdict.";

  const submitLabel = presetRoleTitle ? `Triage for ${presetRoleTitle}` : "Triage & notify";

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <ModalHeader title="Drop anything" subtitle={subtitle} />
      <ModalBody>
        {/* Role picker — only when not preset */}
        {!presetRoleSlug ? (
          <div className="mb-3">
            <label className="label block mb-1.5">Evaluate for</label>
            <select
              value={roleSlug}
              onChange={(e) => setRoleSlug(e.target.value)}
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/60 focus:shadow-focus"
            >
              <option value="">Auto-detect best match from open roles</option>
              {(roles || []).map((r) => (
                <option key={r.id} value={r.slug}>
                  {r.title}
                </option>
              ))}
            </select>
            <p className="text-2xs text-faint mt-1.5 leading-relaxed">
              Leave on auto-detect to let the parser pick from all open roles, or lock to one to score against just that rubric.
            </p>
          </div>
        ) : (
          <div className="mb-3 rounded-md border border-border bg-surface2 px-3 py-2.5 flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-accent shrink-0" />
            <div className="text-2xs text-muted leading-relaxed min-w-0">
              <span className="text-fg font-medium">Evaluating for {presetRoleTitle}</span>
              <span className="text-faint"> · score, dossier, and email will be tied to this role.</span>
            </div>
          </div>
        )}

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) void ingestFiles(e.dataTransfer.files);
          }}
          className={cn(
            "block w-full rounded-md border-2 border-dashed px-4 py-5 mb-3 cursor-pointer",
            "transition-colors duration-150",
            dragOver
              ? "border-accent bg-accent-soft/40"
              : "border-border hover:border-border-strong bg-surface/30",
          )}
        >
          <input
            type="file"
            accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void ingestFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-md bg-surface2 border border-border flex items-center justify-center shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-fg font-medium leading-tight">
                {parsingFile ? `Reading ${parsingFile}…` : "Drop a resume or click to choose"}
              </div>
              <div className="text-2xs text-faint mt-0.5">
                PDF, text, or markdown. Multiple files OK — they stack into one intake.
              </div>
            </div>
            {parsingFile ? <Spinner size={13} /> : null}
          </div>
          {droppedFiles.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {droppedFiles.map((name, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-2xs text-muted bg-surface2 border border-border rounded px-1.5 py-0.5 num">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" />
                  {name}
                </span>
              ))}
            </div>
          ) : null}
        </label>

        <textarea
          autoFocus
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={
            '…or paste here: a LinkedIn URL, a referral note, a snippet you copied from anywhere.\n\nExample: "Rohit just texted me about Vikram — ex-founder, two acquisitions, currently advising. Should be AI PM."'
          }
          className="w-full min-h-[180px] rounded-md border border-border bg-bg p-3.5 text-sm font-mono text-fg leading-relaxed placeholder:text-faint focus:outline-none focus:border-accent/60 focus:shadow-focus"
        />
        {err ? <p className="text-xs text-danger mt-2">{err}</p> : null}
        <p className="text-2xs text-faint mt-3 leading-relaxed">
          Triage scores against {presetRoleTitle ? `the ${presetRoleTitle} rubric` : roleSlug ? "the selected role" : "your open roles"}, writes a dossier, and emails you a verdict — suitable (and why) or passed (and why not). Suitable candidates appear on the kanban.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="accent" size="sm" onClick={submit} disabled={busy || !!parsingFile}>
          {busy ? (
            <>
              <Spinner size={11} className="border-white/30 border-t-white mr-1.5" /> Running intake…
            </>
          ) : (
            submitLabel
          )}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

async function extractTextFromFile(file: File): Promise<string> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf") || file.type === "application/pdf") {
    return extractPdfText(file);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsText(file);
  });
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? (item as { str: string }).str : ""))
      .filter(Boolean)
      .join(" ");
    out.push(text);
  }
  return out.join("\n\n").trim();
}
