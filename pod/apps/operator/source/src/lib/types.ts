export type Stage =
  | "sourced"
  | "reviewed"
  | "intro_sent"
  | "replied"
  | "screen_done"
  | "onsite_done"
  | "offer"
  | "hired"
  // Internally the "rejected" bucket is stored under the existing `closed`
  // enum value on the candidates table — the cloud's enum was provisioned
  // before we added a dedicated 'rejected' option and additive enum
  // migrations aren't supported in-place. Treat `closed` everywhere in the
  // UI as the Rejected column.
  | "closed";

export type OutreachIntent = "intro" | "screening_request" | "offer_letter";

export type Source = "linkedin" | "referral" | "inbound_email" | "twitter" | "site" | "manual";

export type Candidate = {
  id: string;
  number: number;
  name: string;
  email?: string | null;
  linkedin_url?: string | null;
  source: Source;
  source_meta?: Record<string, unknown>;
  role_id?: string | null;
  stage: Stage;
  status: "active" | "passed" | "hired" | "declined";
  score?: number | null;
  next_action?: string | null;
  last_contact?: string | null;
  public_token?: string | null;
  dossier_path?: string | null;
  referrer_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type Role = {
  id: string;
  title: string;
  slug: string;
  must_haves?: string[];
  nice_haves?: string[];
  rubric_file?: string | null;
  pitch_file?: string | null;
  status: "open" | "paused" | "filled" | "closed";
};

export type Message = {
  id: string;
  candidate_id: string;
  direction: "outbound" | "inbound";
  channel: "email" | "whatsapp" | "linkedin" | "slack";
  subject?: string | null;
  body: string;
  status:
    | "draft"
    | "awaiting_approval"
    | "sent"
    | "failed"
    | "ignored"
    | "received";
  intent?: OutreachIntent | string | null;
  created_by?: string | null;
  approved_by_user_id?: string | null;
  sent_at?: string | null;
  thread_ref?: string | null;
  created_at: string;
};

export type Interview = {
  id: string;
  candidate_id: string;
  round: string;
  scheduled_at?: string | null;
  status: "scheduled" | "done" | "no_show" | "cancelled";
  interviewer_email?: string | null;
  // AI screen specific — populated by `evaluate_interview` after a candidate
  // completes the video interview on `candidate-view` and the founder pastes
  // the transcript code. `score` is 0–100; `eval_path` points to the full
  // evaluation JSON in the pod filesystem.
  score?: number | null;
  eval_path?: string | null;
};

export type Task = {
  id: string;
  type: "needs_followup" | "approve_message" | "submit_feedback" | "decide_offer" | "manual_review";
  candidate_id?: string | null;
  title: string;
  due?: string | null;
  status: "pending" | "done" | "snoozed" | "cancelled";
};
