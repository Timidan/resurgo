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
};

export type RunDetail = { summary: RunSummary; result: RunResult; fix_patch: string | null };

type Async<T> = { data: T | null; error: string | null; loading: boolean };

function useFetch<T>(url: string | null): Async<T> {
  const [state, setState] = useState<Async<T>>({ data: null, error: null, loading: url !== null });
  useEffect(() => {
    if (url === null) return;
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
export const useRun = (id: string) => useFetch<RunDetail>(`/api/runs/${encodeURIComponent(id)}`);

/** Fetch several run records at once; ids that fail are left out. */
export function useRunDetails(ids: string[]): { details: RunDetail[]; loading: boolean } {
  const key = ids.join(",");
  const [state, setState] = useState<{ details: RunDetail[]; loading: boolean }>({ details: [], loading: ids.length > 0 });
  useEffect(() => {
    if (!key) {
      setState({ details: [], loading: false });
      return;
    }
    const ctl = new AbortController();
    Promise.all(
      key.split(",").map((id) =>
        fetch(`/api/runs/${encodeURIComponent(id)}`, { signal: ctl.signal })
          .then((r) => (r.ok ? (r.json() as Promise<RunDetail>) : null))
          .catch(() => null),
      ),
    ).then((all) => {
      if (!ctl.signal.aborted) setState({ details: all.filter((d): d is RunDetail => d !== null), loading: false });
    });
    return () => ctl.abort();
  }, [key]);
  return state;
}
