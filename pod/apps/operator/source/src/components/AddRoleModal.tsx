import { useEffect, useState } from "react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { getClient } from "@/lib/client";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/types";

/**
 * Create a role end-to-end from the operator UI.
 *
 * Wraps the backend `create_role` function. On submit we get back a slug, a
 * roles row, and two real markdown files under /knowledge/roles/<slug>/.
 * After that, the role shows up everywhere automatically: the Pipeline filter
 * tabs, the role picker in the intake modal, and the rubric/pitch reads
 * inside the dossier-enricher agent.
 *
 * The form is deliberately opinionated:
 *   - Slug auto-derives from title (operator can override but rarely needs to)
 *   - Must-haves / nice-haves are chip-style multi-add (one per Enter)
 *   - Pitch + rubric default to a working stub if left blank — better a
 *     placeholder than an empty file the agent stares at
 */
export function AddRoleModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (role: { id: string; slug: string; title: string }) => void | Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [slugOverride, setSlugOverride] = useState("");
  const [mustHaves, setMustHaves] = useState<string[]>([]);
  const [niceHaves, setNiceHaves] = useState<string[]>([]);
  const [pitch, setPitch] = useState("");
  const [rubric, setRubric] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setSlugOverride("");
      setMustHaves([]);
      setNiceHaves([]);
      setPitch("");
      setRubric("");
      setBusy(false);
      setErr(null);
    }
  }, [open]);

  const previewSlug = slugify(slugOverride || title);

  async function submit() {
    if (!title.trim()) {
      setErr("A role needs a title — even a working draft like 'AI engineer'.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const client = await getClient();
      const result = await client.functions.run<{
        role_id: string;
        slug: string;
        title: string;
      }>("create_role", {
        title: title.trim(),
        slug: slugOverride.trim() || undefined,
        status: "open",
        must_haves: mustHaves,
        nice_haves: niceHaves,
        pitch: pitch.trim(),
        rubric: rubric.trim(),
      });
      await onCreated({ id: result.role_id, slug: result.slug, title: result.title });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't create the role.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <ModalHeader
        title="Add a role"
        subtitle="The role's rubric is what the AI scores candidates against. Be specific — vague rubric in, vague scores out."
      />
      <ModalBody>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div className="sm:col-span-2">
            <label className="label block mb-1.5">Title</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Founding AI engineer"
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-faint focus:outline-none focus:border-accent/60 focus:shadow-focus"
            />
          </div>
          <div>
            <label className="label block mb-1.5">Slug</label>
            <input
              value={slugOverride}
              onChange={(e) => setSlugOverride(e.target.value)}
              placeholder={previewSlug || "auto"}
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm font-mono text-fg placeholder:text-faint focus:outline-none focus:border-accent/60 focus:shadow-focus"
            />
            <p className="text-2xs text-faint mt-1">
              Used in URLs and file paths. Leave blank to auto-derive.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <ChipField
            label="Must-haves"
            accent
            items={mustHaves}
            onChange={setMustHaves}
            placeholder="Has shipped LLM apps in production"
            help="Hard requirements. Anything missing here drops the score significantly."
          />
          <ChipField
            label="Nice-to-haves"
            items={niceHaves}
            onChange={setNiceHaves}
            placeholder="Open-source presence"
            help="Bonuses. Worth a half-point each when present."
          />
        </div>

        <div className="mb-3">
          <label className="label block mb-1.5">Pitch <span className="text-faint normal-case font-normal">(what the outreach drafter reads)</span></label>
          <textarea
            value={pitch}
            onChange={(e) => setPitch(e.target.value)}
            placeholder="What this role actually does. What the first 90 days look like. Who it's for. Markdown welcome. (Leave blank for a starter stub.)"
            className="w-full min-h-[110px] rounded-md border border-border bg-bg p-3 text-sm font-mono text-fg leading-relaxed placeholder:text-faint focus:outline-none focus:border-accent/60 focus:shadow-focus"
          />
        </div>

        <div className="mb-2">
          <label className="label block mb-1.5">Rubric <span className="text-faint normal-case font-normal">(what the enricher scores against)</span></label>
          <textarea
            value={rubric}
            onChange={(e) => setRubric(e.target.value)}
            placeholder="How the AI should think about scoring this role. Red flags, ideal background, what tips a borderline candidate to a yes. (Leave blank for an auto-generated stub from your must-haves + nice-to-haves.)"
            className="w-full min-h-[110px] rounded-md border border-border bg-bg p-3 text-sm font-mono text-fg leading-relaxed placeholder:text-faint focus:outline-none focus:border-accent/60 focus:shadow-focus"
          />
        </div>

        {err ? <p className="text-xs text-danger mt-2">{err}</p> : null}
        <p className="text-2xs text-faint mt-3 leading-relaxed">
          On submit, the role is created with files at <span className="font-mono text-muted">/knowledge/roles/{previewSlug || "<slug>"}/pitch.md</span> and <span className="font-mono text-muted">/rubric.md</span>. You can keep editing those files directly to refine the AI's reads.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="accent" size="sm" onClick={submit} disabled={busy}>
          {busy ? (
            <><Spinner size={11} className="border-white/30 border-t-white mr-1.5" /> Creating…</>
          ) : (
            "Create role"
          )}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function ChipField({
  label,
  items,
  onChange,
  placeholder,
  help,
  accent,
}: {
  label: string;
  items: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  help?: string;
  accent?: boolean;
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    const v = draft.trim();
    if (!v) return;
    if (items.includes(v)) {
      setDraft("");
      return;
    }
    onChange([...items, v]);
    setDraft("");
  }

  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }

  return (
    <div>
      <label className="label block mb-1.5">{label}</label>
      <div
        className={cn(
          "rounded-md border bg-bg px-2 py-2 focus-within:border-accent/60 focus-within:shadow-focus transition-colors",
          accent ? "border-border" : "border-border",
        )}
      >
        <div className="flex flex-wrap gap-1.5 min-h-[26px]">
          {items.map((it, i) => (
            <span
              key={i}
              className={cn(
                "inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded num border",
                accent
                  ? "bg-accent-soft/40 text-fg border-accent/30"
                  : "bg-surface2 text-muted border-border",
              )}
            >
              {it}
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-faint hover:text-fg ml-0.5 leading-none"
                aria-label={`Remove ${it}`}
              >
                ×
              </button>
            </span>
          ))}
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                commit();
              } else if (e.key === "Backspace" && !draft && items.length) {
                onChange(items.slice(0, -1));
              }
            }}
            onBlur={commit}
            placeholder={items.length ? "" : placeholder}
            className="flex-1 min-w-[80px] bg-transparent text-sm text-fg placeholder:text-faint focus:outline-none py-0.5"
          />
        </div>
      </div>
      {help ? <p className="text-2xs text-faint mt-1 leading-relaxed">{help}</p> : null}
    </div>
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
