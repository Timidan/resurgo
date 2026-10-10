import { useEffect, useState } from "react";

export type Step = {
  name: string;
  command: string;
  exit_code: number;
  duration_s?: number;
  started?: number;
  ended?: number;
  output_tail?: string[];
  package_manager?: string;
};

export type Attempt = {
  source?: string;
  kind?: string;
  files?: string[];
  rationale?: string;
  confidence?: number;
  result?: string;
  status?: string;
  recovered_from_invalid_json?: boolean;
  files_content?: { path: string; content: string }[];
};

export type ModelCall = {
  started?: number;
  duration_s?: number;
  status?: string;
  model?: string;
  effort?: string;
  prompt_chars?: number;
  response_chars?: number;
  tokens_estimated?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

export type Side = {
  passed?: boolean;
  status?: string;
  detail?: string;
  package_manager?: string;
  rules_fired?: string[];
  attempts?: Attempt[];
  steps?: Step[];
  gaps?: string[];
};

export type RunResult = {
  run_id: string;
  repo: string;
  sha: string;
  path?: string;
  agent_version?: string;
  started?: number;
  ended?: number;
  agent?: Side;
  verifier?: Side;
  type?: string;
  type_why?: string;
  image?: string;
  cap_minutes?: number;
  model_calls?: ModelCall[];
  needs_approval?: boolean;
  last_failure?: { step: string; command: string; exit_code: number } | null;
  gaps?: string[];
  fixed?: boolean;
  result?: string;
  trace_id?: string;
};

export type StepBrief = { name: string; ok: boolean; duration_s: number | null };

export type AttemptBrief = {
  kind: string | null;
  files: string[];
  result: string | null;
  status: string | null;
  confidence: number | null;
  rationale: string | null;
};

/**
 * One row of /api/runs. The first block is always there (older records can have null `type` or
 * `fix_kind`). The second block was added later and the list may omit it: read steps, attempts and
 * the rest from /api/runs/{id} instead, and never assume these exist.
 */
export type RunSummary = {
  id: string;
  repo: string | null;
  sha: string | null;
  path: string;
  type: string | null;
  status: string;
  duration_s: number | null;
  model_calls: number;
  fix_kind: string | null;
  needs_approval: boolean;
  started: number | null;
  verified?: boolean;
  gaps?: string[];
  agent_steps?: StepBrief[];
  verifier_steps?: StepBrief[];
  attempts?: AttemptBrief[];
  rules_fired?: string[];
  model?: string | null;
  model_seconds?: number | null;
  error_line?: string | null;
  problems?: { key: string; evidence: string }[];
  patch_preview?: string | null;
  patch_added?: number;
};

export type RunDetail = { summary: RunSummary; result: RunResult; fix_patch: string | null };

type Async<T> = { data: T | null; error: string | null; loading: boolean };

function useFetch<T>(url: string | null): Async<T> {
  const [state, setState] = useState<Async<T>>({ data: null, error: null, loading: url !== null });
  useEffect(() => {
    if (url === null) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    const ctl = new AbortController();
    setState({ data: null, error: null, loading: true });
    fetch(url, { signal: ctl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "Not found" : `Request failed (${r.status})`);
        return (await r.json()) as T;
      })
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((e: unknown) => {
        if ((e as Error).name !== "AbortError") setState({ data: null, error: (e as Error).message, loading: false });
      });
    return () => ctl.abort();
  }, [url]);
  return state;
}

export const useRuns = () => useFetch<RunSummary[]>("/api/runs");
/** One run's full record. Pass null to fetch nothing. */
export const useRun = (id: string | null) => useFetch<RunDetail>(id ? `/api/runs/${encodeURIComponent(id)}` : null);
