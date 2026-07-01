import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { TopBar } from "@/components/layout/TopBar";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { getClient } from "@/lib/client";
import { STAGE_LABELS, scoreTone, cn } from "@/lib/utils";
import type { Candidate, Role, Interview } from "@/lib/types";

/**
 * Side-by-side compare.
 *
 * Reachable via `/compare?ids=<id1>,<id2>,…`. The Pipeline kanban routes
 * here once the founder has picked 2–4 candidates in compare-mode.
 *
 * Why this view exists (the demo talking point):
 *   The kanban shows everyone at a glance. The candidate-detail page shows
 *   one person in depth. Neither shows the AI's *reasoning surface* — the
 *   thing the founder actually uses to decide. Compare lays the same three
 *   facets (rubric fit, dossier highlights, interview signal) next to each
 *   other so the founder reads down a column to evaluate one person, OR
 *   across a row to evaluate one criterion across the slate.
 *
 * Loaded data per candidate:
 *   - candidate row + role row
 *   - dossier markdown (parsed into "Why interesting" / "Concerns" sections)
 *   - interviews row + transcript file (rendered as snippets)
 *
 * Read-only — no actions ship here. The card header is a deep-link to the
 * detail page if the founder wants to act on what they see.
 */

type DossierSections = {
  why: string[];
  concerns: string[];
  talking: string[];
  summary: string;
};

type LoadedCandidate = {
  candidate: Candidate;
  role: Role | null;
  dossier: DossierSections;
  interview: Interview | null;
  interviewSnippets: { q: string; a: string }[];
};

/**
 * Extract the three structured sections we care about from a dossier
 * markdown file. Mirrors the heuristics used by triage_and_notify and
 * draft_outreach's rejection path — keeps the side-by-side view honest
 * to what the AI actually uses internally.
 */
function parseDossier(md: string): DossierSections {
  const sections: DossierSections = { why: [], concerns: [], talking: [], summary: "" };
  if (!md) return sections;
  let current: keyof Omit<DossierSections, "summary"> | null = null;
  const summaryLines: string[] = [];
  let inSummary = true;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    const lower = line.toLowerCase();
    if (lower.startsWith("#")) {
      inSummary = false;
      if (lower.includes("why interesting")) current = "why";
      else if (lower.includes("concern")) current = "concerns";
      else if (lower.includes("talking point")) current = "talking";
      else current = null;
      continue;
    }
    if (current && (line.startsWith("- ") || line.startsWith("* "))) {
      sections[current].push(line.slice(2).trim());
      continue;
    }
    // Anything above the first heading is the auto-generated summary
    // paragraph parse_intake writes at the top of every dossier.
    if (inSummary && line && !line.startsWith(">") && !line.startsWith("---")) {
      summaryLines.push(line);
    }
  }
  sections.summary = summaryLines.join(" ").trim().slice(0, 360);
  return sections;
}

/**
 * Pull a few question/answer pairs out of a saved interview transcript.
 * The transcript is rendered as markdown headed by `## Q1. <question>` /
 * answer body / blank line — see draft_rejection's renderTranscriptMarkdown.
 * We grab the first two Q/A pairs as a representative snippet.
 */
function extractInterviewSnippets(md: string, max = 2): { q: string; a: string }[] {
  if (!md) return [];
  const out: { q: string; a: string }[] = [];
  const re = /^##\s+Q\d+\.\s+(.+?)\s*$([\s\S]*?)(?=^##\s+Q\d+\.|\Z)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) && out.length < max) {
    const q = m[1].trim();
    const a = m[2].trim().split(/\n\n/)[0].trim();
    if (q && a) out.push({ q, a });
  }
  return out;
}

export function Compare() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const ids = useMemo(
    () => (params.get("ids") || "").split(",").map((s) => s.trim()).filter(Boolean),
    [params],
  );
  const [items, setItems] = useState<LoadedCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (ids.length === 0) return;
      setItems(null);
      setError(null);
      try {
        const client = await getClient();
        const loaded = await Promise.all(
          ids.map(async (id): Promise<LoadedCandidate | null> => {
            try {
              const candidate = await client.records.get<Candidate>("candidates", id);
              let role: Role | null = null;
              if (candidate.role_id) {
                try { role = await client.records.get<Role>("roles", candidate.role_id); }
                catch { role = null; }
              }
              let dossier: DossierSections = { why: [], concerns: [], talking: [], summary: "" };
              if (candidate.dossier_path) {
                try {
                  const md = await client.files.read(candidate.dossier_path);
                  dossier = parseDossier(md);
                } catch { /* dossier missing — ok */ }
              }
              // Pull the most recent interview row + its transcript file
              // (path is stashed on `interviewer_email` per our InterviewsPanel
              // convention). Best-effort; absence is fine.
              const ivResp = await client.records.list<Interview>("interviews", {
                filter: { candidate_id: candidate.id },
                limit: 5,
              });
              const interviews = ivResp.items.sort((a, b) =>
                (b.scheduled_at || "").localeCompare(a.scheduled_at || ""),
              );
              const interview = interviews[0] || null;
              let interviewSnippets: { q: string; a: string }[] = [];
              if (interview?.interviewer_email && interview.interviewer_email.startsWith("/")) {
                try {
                  const ivMd = await client.files.read(interview.interviewer_email);
                  interviewSnippets = extractInterviewSnippets(ivMd, 2);
                } catch { /* transcript file missing — ok */ }
              }
              return { candidate, role, dossier, interview, interviewSnippets };
            } catch {
              return null;
            }
          }),
        );
        if (!cancelled) {
          const filtered = loaded.filter((x): x is LoadedCandidate => x !== null);
          if (filtered.length === 0) setError("None of the selected candidates could be loaded.");
          else setItems(filtered);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load candidates.");
      }
    })();
    return () => { cancelled = true; };
  }, [ids]);

  return (
    <>
      <TopBar
        eyebrow="Pipeline"
        title="Side by side"
        actions={
          <>
            <Badge tone="muted">{ids.length} candidate{ids.length === 1 ? "" : "s"}</Badge>
            <Button variant="ghost" size="sm" onClick={() => navigate("/pipeline")}>
              ← Back to kanban
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-auto scrollbar-thin">
        {ids.length < 2 ? (
          <div className="max-w-md mx-auto mt-24 text-center px-6">
            <p className="text-sm text-muted">
              Pick at least 2 candidates from the pipeline before comparing.
            </p>
            <Button variant="accent" size="sm" onClick={() => navigate("/pipeline")} className="mt-4">
              Go to pipeline
            </Button>
          </div>
        ) : items === null ? (
          <div className="flex items-center justify-center py-24 text-muted text-sm gap-2">
            <Spinner size={13} /> Loading candidates…
          </div>
        ) : error ? (
          <div className="max-w-md mx-auto mt-24 text-center px-6 text-sm text-danger">
            {error}
          </div>
        ) : (
          <div
            className="grid gap-3 px-7 py-6"
            style={{
              gridTemplateColumns: `repeat(${items.length}, minmax(280px, 1fr))`,
            }}
          >
            {items.map((it) => (
              <CompareColumn key={it.candidate.id} item={it} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function CompareColumn({ item }: { item: LoadedCandidate }) {
  const { candidate, role, dossier, interview, interviewSnippets } = item;
  const tone = scoreTone(candidate.score);
  const scoreColor =
    tone === "high" ? "text-success" :
    tone === "mid"  ? "text-fg" :
    tone === "low"  ? "text-warning" :
                      "text-faint";

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden flex flex-col">
      {/* Header — name + score + role + deeplink to detail */}
      <div className="px-4 pt-4 pb-3 border-b border-border">
        <Link
          to={`/candidates/${candidate.id}`}
          className="flex items-start gap-3 hover:opacity-90"
          title="Open this candidate's detail page"
        >
          <Avatar name={candidate.name} size="sm" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-fg leading-tight truncate">
              {candidate.name}
            </h3>
            <div className="text-2xs text-muted mt-0.5 truncate">
              {role?.title || <span className="text-faint">No role yet</span>}
            </div>
          </div>
          {candidate.score != null ? (
            <span
              className={cn(
                "shrink-0 inline-flex items-center justify-center rounded-md h-7 min-w-[36px] px-2 num text-sm font-semibold bg-bg chip-inset",
                scoreColor,
              )}
              title="AI score (0–10) from parse_intake"
            >
              {candidate.score.toFixed(1)}
            </span>
          ) : null}
        </Link>
        <div className="mt-3 flex items-center gap-1.5 flex-wrap">
          <Badge tone="muted" dot>{STAGE_LABELS[candidate.stage] || candidate.stage}</Badge>
          <span className="text-2xs text-faint uppercase tracking-widest">
            {candidate.source}
          </span>
        </div>
      </div>

      {/* Dossier summary — the one-paragraph auto-summary parse_intake writes */}
      <Block title="Summary">
        {dossier.summary ? (
          <p className="text-xs text-fg/80 leading-relaxed">{dossier.summary}</p>
        ) : (
          <Empty>No dossier on file.</Empty>
        )}
      </Block>

      {/* Rubric — must-haves from the role, marked vs the candidate where we have signal.
          We don't have explicit match data, so we render the rubric verbatim and let
          the dossier sections (below) speak for themselves. */}
      <Block title="Role rubric">
        {role?.must_haves && role.must_haves.length > 0 ? (
          <ul className="space-y-1.5">
            {role.must_haves.slice(0, 6).map((m, i) => (
              <li key={i} className="text-xs text-fg/80 flex gap-2 leading-snug">
                <span className="text-accent-2 shrink-0">·</span>
                <span>{m}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No must-haves defined.</Empty>
        )}
      </Block>

      <Block title="Why interesting" accent="success">
        {dossier.why.length > 0 ? (
          <ul className="space-y-1.5">
            {dossier.why.slice(0, 5).map((w, i) => (
              <li key={i} className="text-xs text-fg/85 flex gap-2 leading-snug">
                <span className="text-success shrink-0">+</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Nothing flagged.</Empty>
        )}
      </Block>

      <Block title="Concerns" accent="warning">
        {dossier.concerns.length > 0 ? (
          <ul className="space-y-1.5">
            {dossier.concerns.slice(0, 5).map((c, i) => (
              <li key={i} className="text-xs text-fg/85 flex gap-2 leading-snug">
                <span className="text-warning shrink-0">!</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>None flagged.</Empty>
        )}
      </Block>

      <Block title="Interview signal">
        {interview ? (
          <>
            <div className="text-2xs text-faint mb-2 num">
              {interview.round.replace(/_/g, " ")} · {interview.status}
            </div>
            {interviewSnippets.length > 0 ? (
              <div className="space-y-3">
                {interviewSnippets.map((s, i) => (
                  <div key={i}>
                    <div className="text-2xs text-muted italic leading-snug">{s.q}</div>
                    <div className="text-xs text-fg/85 mt-1 leading-relaxed line-clamp-4">
                      {s.a}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>Transcript not yet pasted.</Empty>
            )}
          </>
        ) : (
          <Empty>No interview rounds yet.</Empty>
        )}
      </Block>

      <Block title="Next action">
        <p className="text-xs text-fg/80 leading-relaxed">
          {candidate.next_action || <span className="text-faint italic">No next action set.</span>}
        </p>
      </Block>
    </div>
  );
}

function Block({
  title,
  accent,
  children,
}: {
  title: string;
  accent?: "success" | "warning";
  children: React.ReactNode;
}) {
  const tint =
    accent === "success" ? "border-success/30" :
    accent === "warning" ? "border-warning/30" :
                           "border-border";
  return (
    <div className={cn("px-4 py-3 border-t", tint)}>
      <div className="text-2xs uppercase tracking-widest text-faint font-medium mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-2xs text-faint italic leading-snug">{children}</p>;
}
