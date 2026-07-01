import { useCallback, useEffect, useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { IntakeModal } from "@/components/IntakeModal";
import { AddRoleModal } from "@/components/AddRoleModal";
import { getClient } from "@/lib/client";
import { cn } from "@/lib/utils";
import type { Candidate, Role } from "@/lib/types";

export function Roles() {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [addRoleOpen, setAddRoleOpen] = useState(false);
  const [intakeFor, setIntakeFor] = useState<Role | null>(null);
  const [deleteFor, setDeleteFor] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Holds the full candidate list so we can null out role_id on assigned
  // candidates before deleting their role (the platform doesn't cascade).
  const [allCandidates, setAllCandidates] = useState<Candidate[]>([]);

  const refresh = useCallback(async () => {
    const client = await getClient();
    const [r, c] = await Promise.all([
      client.records.list<Role>("roles", { limit: 100 }),
      client.records.list<Candidate>("candidates", { limit: 500 }),
    ]);
    setRoles(r.items);
    setAllCandidates(c.items);
    const tally: Record<string, number> = {};
    c.items.forEach((cand) => {
      if (!cand.role_id || cand.status !== "active") return;
      tally[cand.role_id] = (tally[cand.role_id] || 0) + 1;
    });
    setCounts(tally);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Detach any candidates still pointing at the role we're about to delete,
  // then drop the role row itself. Done sequentially because a partial
  // failure mid-cascade should leave the world in a recoverable state — the
  // founder retries and the now-orphan candidates will be detached on the
  // second pass.
  async function confirmDelete(role: Role) {
    setDeleting(true);
    setDeleteError(null);
    try {
      const client = await getClient();
      const orphans = allCandidates.filter((c) => c.role_id === role.id);
      for (const cand of orphans) {
        await client.records.update<Candidate>("candidates", cand.id, { role_id: null });
      }
      await client.records.delete("roles", role.id);
      setDeleteFor(null);
      await refresh();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Couldn't delete the role.");
    } finally {
      setDeleting(false);
    }
  }

  const open = roles?.filter((r) => r.status === "open").length ?? 0;

  return (
    <>
      <TopBar
        eyebrow="Pipeline"
        title="Roles"
        actions={
          <>
            <Badge tone="muted">{open} open</Badge>
            <Button variant="accent" size="sm" onClick={() => setAddRoleOpen(true)}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add role
            </Button>
          </>
        }
      />
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-4xl mx-auto px-7 py-6 space-y-3">
          {roles === null ? (
            <div className="flex items-center justify-center py-20 text-muted text-sm gap-2">
              <Spinner size={13} /> Loading roles…
            </div>
          ) : roles.length === 0 ? (
            <EmptyState
              title="No roles yet"
              description="Add your first role to start triaging candidates. Each role gets a rubric and a pitch file the AI reads when scoring and drafting."
              action={
                <Button variant="accent" size="sm" onClick={() => setAddRoleOpen(true)}>
                  Add your first role
                </Button>
              }
            />
          ) : (
            roles.map((r) => (
              <article
                key={r.id}
                className="bg-surface border border-border rounded-lg overflow-hidden hover:border-border-strong transition-colors"
              >
                <header className="px-5 pt-4 pb-3 border-b border-border flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-md font-semibold text-fg tracking-tight leading-tight">{r.title}</h3>
                    <div className="text-2xs text-faint uppercase tracking-widest mt-1.5 font-mono">{r.slug}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge tone={r.status === "open" ? "success" : "muted"} dot>{r.status}</Badge>
                    <span className="text-xs text-muted num">
                      <span className="text-fg font-semibold">{counts[r.id] || 0}</span> in pipeline
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIntakeFor(r)}
                      disabled={r.status !== "open"}
                      title={
                        r.status === "open"
                          ? `Add a candidate and evaluate against ${r.title}`
                          : `Role is ${r.status} — re-open it before adding candidates.`
                      }
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      Add candidate
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setDeleteError(null); setDeleteFor(r); }}
                      title={`Delete ${r.title}. Any candidates assigned to it will be detached, not removed.`}
                      className="text-danger hover:text-danger"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
                        <path d="M10 11v6"></path>
                        <path d="M14 11v6"></path>
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
                      </svg>
                    </Button>
                  </div>
                </header>
                <div className="px-5 py-4 grid sm:grid-cols-2 gap-5">
                  <Section title="Must-haves" items={r.must_haves || []} accent />
                  <Section title="Nice-to-haves" items={r.nice_haves || []} />
                </div>
                {(r.rubric_file || r.pitch_file) ? (
                  <footer className="px-5 pb-4 pt-1 flex flex-wrap items-center gap-1.5">
                    {r.rubric_file ? (
                      <code className="text-2xs font-mono text-faint bg-subtle border border-border px-2 py-1 rounded">
                        {r.rubric_file}
                      </code>
                    ) : null}
                    {r.pitch_file ? (
                      <code className="text-2xs font-mono text-faint bg-subtle border border-border px-2 py-1 rounded">
                        {r.pitch_file}
                      </code>
                    ) : null}
                  </footer>
                ) : null}
              </article>
            ))
          )}
        </div>
      </div>

      <AddRoleModal
        open={addRoleOpen}
        onClose={() => setAddRoleOpen(false)}
        onCreated={async () => {
          await refresh();
        }}
      />

      <IntakeModal
        open={!!intakeFor}
        onClose={() => setIntakeFor(null)}
        onCreated={async () => {
          await refresh();
        }}
        presetRoleSlug={intakeFor?.slug}
        presetRoleTitle={intakeFor?.title}
      />

      {/* Delete-role confirmation. The button is in the role row's header but
          the modal lives here so it survives the row unmount mid-deletion. */}
      {deleteFor ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 backdrop-blur-sm px-4"
          onClick={() => !deleting && setDeleteFor(null)}
        >
          <div
            className="bg-surface border border-border rounded-lg shadow-xl max-w-md w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-md font-semibold text-fg tracking-tight">Delete this role?</h3>
            <p className="text-sm text-muted mt-2 leading-relaxed">
              <span className="text-fg font-medium">{deleteFor.title}</span> will be removed
              permanently. Its rubric and pitch files stay on disk under{" "}
              <code className="font-mono text-2xs text-fg">/knowledge/roles/{deleteFor.slug}/</code>{" "}
              — clean them up manually if you don't need them.
              {(counts[deleteFor.id] || 0) > 0 ? (
                <>
                  {" "}
                  <span className="text-warning font-medium">
                    {counts[deleteFor.id]} candidate{counts[deleteFor.id] === 1 ? "" : "s"}
                  </span>{" "}
                  currently in pipeline will be detached (kept on the kanban with no role assignment).
                </>
              ) : null}
            </p>
            {deleteError ? (
              <div className="mt-3 text-xs text-danger bg-danger/10 border border-danger/30 rounded px-3 py-2">
                {deleteError}
              </div>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDeleteFor(null)} disabled={deleting}>
                Cancel
              </Button>
              <Button
                variant="accent"
                size="sm"
                onClick={() => confirmDelete(deleteFor)}
                disabled={deleting}
                className="bg-danger hover:bg-danger/90 border-danger text-white"
              >
                {deleting ? <><Spinner size={11} className="mr-1.5" /> Deleting…</> : "Delete role"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Section({ title, items, accent = false }: { title: string; items: string[]; accent?: boolean }) {
  return (
    <div>
      <div className="label mb-2">{title}</div>
      {items.length === 0 ? (
        <p className="text-xs text-faint italic">none specified</p>
      ) : (
        <ul className="space-y-1.5">
          {items.slice(0, 6).map((m, i) => (
            <li key={i} className={cn("text-sm flex gap-2 leading-snug", accent ? "text-fg/90" : "text-muted")}>
              <span className={accent ? "text-accent-2" : "text-faint"}>·</span>
              <span>{m}</span>
            </li>
          ))}
          {items.length > 6 ? (
            <li className="text-2xs text-faint italic ml-3">+ {items.length - 6} more</li>
          ) : null}
        </ul>
      )}
    </div>
  );
}
