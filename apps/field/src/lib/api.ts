/** HTTP client for the Swen server's device API. Works in browsers and Node 20+. */
import {
  API_PREFIX,
  type ApiErrorCode,
  type EnrollResponse,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type RosterResponse,
  type UnlockResponse,
} from "@swen/core";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ApiErrorCode | "network" | "timeout",
    public retryAt?: string,
  ) {
    super(code);
  }
  /** True when the server could not be reached at all (offline, DNS, timeout). */
  get offline(): boolean {
    return this.code === "network" || this.code === "timeout";
  }
}

export interface ApiAuth {
  serverUrl: string;
  deviceToken?: string;
  sessionToken?: string;
}

const TIMEOUT_MS = 20_000;

async function call<T>(auth: ApiAuth, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ data: T; sentAt: number; receivedAt: number }> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (auth.deviceToken) headers.Authorization = `Bearer ${auth.deviceToken}`;
  if (auth.sessionToken) headers["X-Staff-Session"] = auth.sessionToken;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const sentAt = Date.now();
  let res: Response;
  try {
    res = await fetch(`${auth.serverUrl.replace(/\/+$/, "")}${API_PREFIX}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (e) {
    throw new ApiError(0, (e as Error).name === "AbortError" ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
  const receivedAt = Date.now();
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON (e.g. a captive portal page): treat as offline
    throw new ApiError(res.status, "network");
  }
  if (!res.ok) {
    const err = body as { error?: ApiErrorCode; retryAt?: string };
    throw new ApiError(res.status, err?.error ?? "server_error", err?.retryAt);
  }
  return { data: body as T, sentAt, receivedAt };
}

export const api = {
  health: (serverUrl: string) => call<{ ok: boolean; serverTime: string }>({ serverUrl }, "/health"),
  enroll: (serverUrl: string, body: { code: string; deviceName: string; appVersion: string }) => call<EnrollResponse>({ serverUrl }, "/enroll", { method: "POST", body }),
  roster: (auth: ApiAuth) => call<RosterResponse>(auth, "/roster"),
  unlock: (auth: ApiAuth, body: { staffId: string; pin: string }) => call<UnlockResponse>(auth, "/unlock", { method: "POST", body }),
  push: (auth: ApiAuth, body: PushRequest) => call<PushResponse>(auth, "/sync/push", { method: "POST", body }),
  pull: (auth: ApiAuth, cursor: string | undefined) =>
    call<PullResponse>(auth, `/sync/pull${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
};
