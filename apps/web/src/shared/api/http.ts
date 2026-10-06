import type { Problem } from '@stockroom/contracts';

export type ProblemDetails = Problem & Record<string, unknown>;

export class ProblemError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = 'ProblemError';
  }

  get code(): string {
    return this.problem.code;
  }

  get status(): number {
    return this.problem.status;
  }

  get fieldErrors(): { path: string; message: string }[] {
    return this.problem.errors ?? [];
  }
}

export const API_BASE = '/api/v1';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export type ApiResponse<T> = { data: T; headers: Headers; status: number };

function fallbackProblem(status: number, detail: string): ProblemDetails {
  return { type: 'about:blank', title: 'Request failed', status, code: status === 0 ? 'NETWORK_ERROR' : 'HTTP_ERROR', detail };
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { accept: 'application/json', 'x-request-id': crypto.randomUUID(), ...options.headers };
  let body: BodyInit | undefined;
  if (options.body instanceof FormData) body = options.body;
  else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { method: options.method ?? 'GET', headers, body, signal: options.signal });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ProblemError(fallbackProblem(0, 'Could not reach the server. Check that the stack is running.'));
  }
  if (response.status === 204) return { data: undefined as T, headers: response.headers, status: 204 };
  const text = await response.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!response.ok) {
    const problem =
      json && typeof json === 'object' && 'code' in json ? (json as ProblemDetails) : fallbackProblem(response.status, text.slice(0, 200));
    throw new ProblemError(problem);
  }
  return { data: json as T, headers: response.headers, status: response.status };
}

export function describeError(error: unknown): string {
  if (error instanceof ProblemError) return error.problem.detail ?? error.problem.title;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}
