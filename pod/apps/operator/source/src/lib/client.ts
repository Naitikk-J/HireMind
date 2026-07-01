/**
 * Hiremind client adapter.
 *
 * Resolves the live LemmaClient at runtime via the script-injected
 * `window.LemmaClient` (matching the pattern the Lemma backend uses
 * for both Vite-deployed and HTML apps). When the SDK isn't available
 * (e.g. local prototyping without a Lemma backend running) we fall
 * back to the in-memory mock so the UI runs end-to-end.
 */

import {
  mockCandidates,
  mockRoles,
  mockMessages,
  mockInterviews,
  mockTasks,
  mockDossier,
} from "./mock";
import type {
  Candidate,
  Role,
  Message,
  Interview,
  Task,
} from "./types";

type ListResponse<T> = { items: T[]; total?: number };

type RecordsApi = {
  list<T>(table: string, opts?: { filter?: Record<string, unknown>; limit?: number }): Promise<ListResponse<T>>;
  get<T>(table: string, id: string): Promise<T>;
  create<T>(table: string, data: Partial<T>): Promise<T>;
  update<T>(table: string, id: string, data: Partial<T>): Promise<T>;
  /**
   * Permanently delete a record. The operator is responsible for first
   * cleaning up references (e.g. nulling out role_id on candidates before
   * deleting a role) — the datastore won't cascade for them.
   */
  delete(table: string, id: string): Promise<void>;
};

type WorkflowRunStatus = "WAITING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED";
type WorkflowRunSnapshot = {
  id: string;
  status: WorkflowRunStatus;
  current_node_id?: string | null;
  failed_node_id?: string | null;
  error?: string | null;
  execution_context?: Record<string, unknown>;
};

/**
 * Outreach kinds the founder can kick off from the candidate detail page.
 * Maps 1:1 to the `intent` enum on the backend's `outreach` workflow.
 */
export type OutreachIntentKind = "intro" | "screening_request" | "offer_letter";

type WorkflowsApi = {
  run(name: string, opts?: { data?: Record<string, unknown> }): Promise<{ run_id: string }>;
  getRun(runId: string): Promise<WorkflowRunSnapshot>;
  /**
   * Poll a run until it reaches a terminal status (COMPLETED/FAILED/CANCELED)
   * or the timeout elapses. Throws on FAILED with the backend error message
   * so callers can route the failure to user-facing UI.
   */
  waitForRun(runId: string, opts?: { timeoutMs?: number; pollMs?: number }): Promise<WorkflowRunSnapshot>;
  submitForm(runId: string, nodeId: string, inputs: Record<string, unknown>): Promise<void>;
  /**
   * Route a draft approval through the outreach workflow's `approve` form
   * instead of mutating the messages row directly. This is the difference
   * between "the row says sent" and "the platform sent it" — only the
   * workflow path invokes `send_outreach`, advances the candidate stage,
   * and creates the follow-up task.
   *
   * Returns true if a matching waiting run was found and advanced, false
   * if no live run was found (e.g. the draft was created before the
   * workflow integration was wired and is now orphaned).
   */
  approveDraft(messageId: string, opts?: { edited_subject?: string; edited_body?: string }): Promise<boolean>;
  declineDraft(messageId: string, reason: string): Promise<boolean>;
};

type FilesApi = {
  read(path: string): Promise<string>;
  /**
   * Write a text file to the pod's filesystem. Returns silently on success.
   * Implemented on top of the SDK's `files.upload(Blob, { directoryPath, name })`,
   * which is the only write primitive exposed to the browser. Existing files
   * at the same path are replaced.
   */
  writeText(path: string, content: string): Promise<void>;
};

type FunctionsApi = {
  /**
   * Invoke a pod function synchronously and return its parsed output. The
   * Lemma SDK returns the function's result envelope; we surface the
   * `result` field (matching the function's declared output schema).
   */
  run<T = unknown>(name: string, input: Record<string, unknown>): Promise<T>;
};

export type HiremindClient = {
  ready: Promise<boolean>;
  isMock: boolean;
  records: RecordsApi;
  workflows: WorkflowsApi;
  functions: FunctionsApi;
  files: FilesApi;
  watchCandidates(onChange: () => void): () => void;
};

declare global {
  interface Window {
    __LEMMA_CONFIG__?: { apiUrl?: string; authUrl?: string; podId?: string };
    LemmaClient?: { LemmaClient: new (...args: unknown[]) => unknown };
  }
}

function loadLemmaSdk(): Promise<unknown | null> {
  return new Promise((resolve) => {
    const cfg = window.__LEMMA_CONFIG__;
    if (!cfg?.apiUrl) {
      resolve(null);
      return;
    }
    if (window.LemmaClient?.LemmaClient) {
      try {
        resolve(new window.LemmaClient.LemmaClient());
      } catch {
        resolve(null);
      }
      return;
    }
    const base = cfg.apiUrl.replace(/\/$/, "");
    const script = document.createElement("script");
    script.src = `${base}/public/sdk/lemma-client.js`;
    script.onload = () => {
      try {
        if (window.LemmaClient?.LemmaClient) {
          resolve(new window.LemmaClient.LemmaClient());
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      }
    };
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
}

function createMockClient(): HiremindClient {
  const candidates: Candidate[] = JSON.parse(JSON.stringify(mockCandidates));
  const roles: Role[] = JSON.parse(JSON.stringify(mockRoles));
  const messages: Message[] = JSON.parse(JSON.stringify(mockMessages));
  const interviews: Interview[] = JSON.parse(JSON.stringify(mockInterviews));
  const tasks: Task[] = JSON.parse(JSON.stringify(mockTasks));

  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((fn) => fn());

  const TABLES: Record<string, unknown[]> = {
    candidates, roles, messages, interviews, tasks,
  };

  const records: RecordsApi = {
    async list(table, opts) {
      const rows = TABLES[table] || [];
      let filtered = rows.slice();
      if (opts?.filter) {
        filtered = filtered.filter((r) =>
          Object.entries(opts.filter!).every(([k, v]) => (r as Record<string, unknown>)[k] === v),
        );
      }
      const limit = opts?.limit ?? filtered.length;
      return { items: filtered.slice(0, limit) as never, total: filtered.length };
    },
    async get(table, id) {
      const row = (TABLES[table] || []).find((r) => (r as { id: string }).id === id);
      if (!row) throw new Error(`Not found: ${table}/${id}`);
      return row as never;
    },
    async create(table, data) {
      const row = {
        id: `mock-${Math.random().toString(36).slice(2, 10)}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...data,
      };
      (TABLES[table] || (TABLES[table] = [])).push(row as unknown);
      notify();
      return row as never;
    },
    async update(table, id, data) {
      const rows = TABLES[table] || [];
      const idx = rows.findIndex((r) => (r as { id: string }).id === id);
      if (idx === -1) throw new Error(`Not found: ${table}/${id}`);
      rows[idx] = { ...(rows[idx] as object), ...data, updated_at: new Date().toISOString() } as never;
      notify();
      return rows[idx] as never;
    },
    async delete(table, id) {
      const rows = TABLES[table] || [];
      const idx = rows.findIndex((r) => (r as { id: string }).id === id);
      if (idx === -1) throw new Error(`Not found: ${table}/${id}`);
      rows.splice(idx, 1);
      notify();
    },
  };

  const workflows: WorkflowsApi = {
    async approveDraft(messageId, opts) {
      await records.update("messages", messageId, {
        ...(opts?.edited_subject !== undefined ? { subject: opts.edited_subject } : {}),
        ...(opts?.edited_body !== undefined ? { body: opts.edited_body } : {}),
        status: "sent",
        sent_at: new Date().toISOString(),
        thread_ref: `mock-preview:${Date.now()}`,
      });
      return true;
    },
    async declineDraft(messageId, reason) {
      await records.update("messages", messageId, {
        status: "ignored",
        decline_reason: reason,
      });
      return true;
    },
    async run(name, opts) {
      if (name === "intake" && opts?.data) {
        const data = opts.data as { raw?: string };
        const raw = String(data?.raw || "").trim();
        const synthesizedName = (() => {
          if (!raw) return "Unknown Candidate";
          const m = raw.match(/linkedin\.com\/in\/([\w.-]+)/i);
          if (m) {
            return m[1]
              .split(/[-.]/)
              .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
              .join(" ");
          }
          const first = raw.split(/[\n\r,]/)[0].trim();
          return first.length > 60 ? "New Candidate" : first;
        })();
        await records.create("candidates", {
          name: synthesizedName,
          source: "manual",
          stage: "sourced",
          status: "active",
          score: 7.5,
          next_action: "Review dossier (mock)",
          public_token: `${synthesizedName.toLowerCase().replace(/\s+/g, "-")}-${Math.random().toString(36).slice(2, 8)}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      return { run_id: `mock-run-${Math.random().toString(36).slice(2, 10)}` };
    },
    async getRun(runId) {
      return { id: runId, status: "COMPLETED" as const };
    },
    async waitForRun(runId) {
      return { id: runId, status: "COMPLETED" as const };
    },
    async submitForm() {},
  };

  const files: FilesApi = {
    async read(path) {
      const m = path.match(/^\/candidates\/([^/]+)\/dossier\.md$/);
      if (m) return mockDossier(m[1]);
      return "_(mock filesystem — no file at this path)_";
    },
    async writeText() {
      // Mock filesystem: pretend the write succeeded. The dev loop reads the
      // transcript back via the interview row's `interviewer_email` pointer.
    },
  };

  const functions: FunctionsApi = {
    // Mock: just echo a synthetic result. Real pods route this to the
    // backend's function runner via the SDK below.
    async run<T>(name: string, _input: Record<string, unknown>) {
      if (name === "create_role") {
        return {
          role_id: `mock-role-${Math.random().toString(36).slice(2, 8)}`,
          slug: "mock-role",
          title: "Mock Role",
        } as unknown as T;
      }
      return {} as T;
    },
  };

  return {
    ready: Promise.resolve(false),
    isMock: true,
    records,
    workflows,
    functions,
    files,
    watchCandidates(onChange) {
      listeners.add(onChange);
      return () => { listeners.delete(onChange); };
    },
  };
}

/**
 * Locate the workflow run currently waiting on an `approve` form for a given
 * draft message. We scan the user's "waiting assigned to me" list (cheap
 * summary call) for waits parked on `current_node_id === "approve"`, then
 * fetch each candidate run and match by `execution_context.record_draft.message_id`.
 *
 * N+1 by design: a founder's approval queue is small (<20), and adding a
 * dedicated index for this lookup would mean a schema change. Returns the
 * first match (there will only ever be one — a draft has one open run).
 */
async function findApprovalRun(
  raw: any,
  messageId: string,
): Promise<{ runId: string; nodeId: string } | null> {
  const page = await raw.workflows.runs.waitingAssignedToMe({ limit: 100 });
  const assignments = (page?.items ?? []) as Array<{
    run: { id: string; current_node_id?: string | null };
    wait: { node_id: string; wait_type: string };
  }>;
  const candidates = assignments.filter(
    (a) => a.run.current_node_id === "approve" && a.wait.wait_type === "HUMAN",
  );
  for (const a of candidates) {
    try {
      const fullRun = await raw.workflows.runs.get(a.run.id);
      const ctx = fullRun?.execution_context ?? {};
      if (ctx?.record_draft?.message_id === messageId) {
        return { runId: a.run.id, nodeId: a.wait.node_id };
      }
    } catch {
      // ignore individual fetch failures and continue scanning
    }
  }
  return null;
}

/**
 * Translate the operator UI's simple `{ field: value }` equality filter into
 * the SDK's structured filter array (`{ field, op, value }[]`). All values
 * are matched with `eq`; multiple fields combine with implicit AND.
 */
function toSdkFilters(filter?: Record<string, unknown>) {
  if (!filter) return undefined;
  return Object.entries(filter)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([field, value]) => ({ field, op: "eq", value }));
}

function wrapLemmaClient(raw: any): HiremindClient {
  return {
    ready: Promise.resolve(true),
    isMock: false,
    records: {
      async list(table, opts) {
        const res = await raw.records.list(table, {
          filters: toSdkFilters(opts?.filter),
          limit: opts?.limit ?? 100,
        });
        return {
          items: (res?.items ?? []) as never,
          total: res?.total ?? undefined,
        };
      },
      async get(table, id) {
        return raw.records.get(table, id);
      },
      async create(table, data) {
        return raw.records.create(table, data);
      },
      async update(table, id, data) {
        return raw.records.update(table, id, data);
      },
      async delete(table, id) {
        await raw.records.delete(table, id);
      },
    },
    workflows: {
      /**
       * Start a workflow run. If the workflow's first node is a FORM and the
       * caller passed `opts.data`, submit it immediately so the run advances
       * past the form without another round-trip. This mirrors the
       * "fire-and-forget with inputs" ergonomics the operator UI expects.
       */
      async run(name, opts) {
        const run = await raw.workflows.runs.create(name);
        const wait = run?.active_wait;
        // FORM nodes surface as wait_type === "HUMAN" in the SDK (they're
        // waiting for human input). Auto-submit when caller supplied inputs.
        if (opts?.data && wait?.wait_type === "HUMAN" && wait.node_id) {
          await raw.workflows.runs.submitForm(run.id, {
            node_id: wait.node_id,
            inputs: opts.data,
          });
        }
        return { run_id: run?.id ?? "" };
      },
      async getRun(runId) {
        const r = await raw.workflows.runs.get(runId);
        return {
          id: r?.id ?? runId,
          status: (r?.status ?? "RUNNING") as WorkflowRunStatus,
          current_node_id: r?.current_node_id ?? null,
          failed_node_id: r?.failed_node_id ?? null,
          error: r?.error ?? null,
          execution_context: r?.execution_context ?? {},
        };
      },
      async waitForRun(runId, opts) {
        const timeoutMs = opts?.timeoutMs ?? 120_000;
        const pollMs = opts?.pollMs ?? 2500;
        const started = Date.now();
        // Initial brief delay — most workflows are mid-flight by the time
        // submitForm returns; jumping straight to a poll usually catches
        // them in RUNNING.
        await new Promise((r) => setTimeout(r, 800));
        while (true) {
          const snap = await this.getRun(runId);
          if (snap.status === "COMPLETED") return snap;
          if (snap.status === "FAILED" || snap.status === "CANCELED") {
            throw new Error(snap.error || `Workflow ${snap.status.toLowerCase()}.`);
          }
          if (Date.now() - started > timeoutMs) {
            throw new Error("Workflow is taking longer than expected — check the run log.");
          }
          await new Promise((r) => setTimeout(r, pollMs));
        }
      },
      async submitForm(runId, nodeId, inputs) {
        await raw.workflows.runs.submitForm(runId, { node_id: nodeId, inputs });
      },
      /**
       * Approve a draft and trigger the send.
       *
       * Two paths — both end with a real Gmail send:
       *  1. **Workflow path** (drafted by running the `outreach` workflow):
       *     resume the paused `approve` FORM node so the DAG advances through
       *     `decision → send_outreach → END` like the PRD intends.
       *  2. **Direct path** (draft was seeded any other way — backfill, manual
       *     `records create`, an old workflow that aborted): apply edits to
       *     the row, then invoke `send_outreach(message_id)` ourselves.
       *
       * Returns `true` either way. The legacy "no workflow → return false"
       * dead-end (the cause of the red banner) is gone.
       */
      async approveDraft(messageId, opts) {
        if (opts?.edited_subject !== undefined || opts?.edited_body !== undefined) {
          await raw.records.update("messages", messageId, {
            ...(opts.edited_subject !== undefined ? { subject: opts.edited_subject } : {}),
            ...(opts.edited_body !== undefined ? { body: opts.edited_body } : {}),
          });
        }
        const runInfo = await findApprovalRun(raw, messageId);
        if (runInfo) {
          await raw.workflows.runs.submitForm(runInfo.runId, {
            node_id: runInfo.nodeId,
            inputs: {
              approved: true,
              ...(opts?.edited_subject !== undefined ? { edited_subject: opts.edited_subject } : {}),
              ...(opts?.edited_body !== undefined ? { edited_body: opts.edited_body } : {}),
            },
          });
          return true;
        }
        await raw.functions.run("send_outreach", { input: { message_id: messageId } });
        return true;
      },
      async declineDraft(messageId, reason) {
        const runInfo = await findApprovalRun(raw, messageId);
        if (runInfo) {
          await raw.workflows.runs.submitForm(runInfo.runId, {
            node_id: runInfo.nodeId,
            inputs: { approved: false, decline_reason: reason },
          });
          return true;
        }
        // Workflowless decline: just mark the row ignored so it leaves the
        // queue. We don't persist `reason` here because the `messages` table
        // doesn't have that column — the Activity tab can show "Declined" by
        // reading `status` transitions instead.
        await raw.records.update("messages", messageId, { status: "ignored" });
        return true;
      },
    },
    files: {
      async read(path) {
        const blob: Blob = await raw.files.download(path);
        return await blob.text();
      },
      async writeText(path, content) {
        // Split the absolute pod path into a directory + filename pair, which
        // is the shape the upload API expects.
        const trimmed = path.startsWith("/") ? path : `/${path}`;
        const idx = trimmed.lastIndexOf("/");
        const dir = idx > 0 ? trimmed.slice(0, idx) : "/";
        const name = trimmed.slice(idx + 1);
        const blob = new Blob([content], { type: "text/markdown" });
        await raw.files.upload(blob, { directoryPath: dir, name });
      },
    },
    functions: {
      // The Lemma SDK returns a `FunctionRunResponse` with `output_data`
      // holding the function's declared output. Surface that directly so
      // callers can type against the function's output schema. If the
      // function FAILED, raise so the UI can surface a clear error.
      async run<T>(name: string, input: Record<string, unknown>) {
        const resp = await raw.functions.run(name, { input });
        if (resp?.status === "FAILED" || resp?.status === "failed") {
          throw new Error(resp.error || `Function ${name} failed.`);
        }
        const data = (resp?.output_data ?? resp?.result ?? resp?.data ?? resp) as T;
        return data;
      },
    },
    /**
     * Bridge our single `watchCandidates(onChange)` API onto the SDK's
     * one-table-per-stream `datastore.watchChanges` primitive. We open
     * three streams (candidates, messages, interviews) and fire the
     * consolidated callback on any change.
     */
    watchCandidates(onChange) {
      const handles: Array<{ close(): void }> = [];
      for (const table of ["candidates", "messages", "interviews"]) {
        try {
          const h = raw.datastore.watchChanges({
            table,
            onChange: () => onChange(),
          });
          if (h) handles.push(h);
        } catch {
          // Best-effort: if the websocket can't open we silently degrade —
          // the UI still works via manual refreshes and routing.
        }
      }
      return () => {
        for (const h of handles) {
          try { h.close(); } catch { /* ignore */ }
        }
      };
    },
  };
}

let _client: HiremindClient | null = null;

export async function getClient(): Promise<HiremindClient> {
  if (_client) return _client;
  const raw = await loadLemmaSdk();
  if (raw) {
    try {
      await (raw as any).initialize?.();
      _client = wrapLemmaClient(raw);
      return _client;
    } catch {
      // fall through to mock
    }
  }
  _client = createMockClient();
  return _client;
}
