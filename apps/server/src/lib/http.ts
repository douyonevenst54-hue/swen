import type { ApiError, ApiErrorCode } from "@swen/core";
import { NextResponse } from "next/server";

/**
 * The field app may be served from another origin (e.g. a local server in the
 * clinic), so the device API allows cross-origin calls. Auth is by bearer
 * token, never cookies, so a wildcard origin is safe here.
 */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Staff-Session",
  "Access-Control-Max-Age": "86400",
};

export function json<T>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } });
}

export function apiError(status: number, error: ApiErrorCode, extra: Omit<ApiError, "error"> = {}): NextResponse {
  return json<ApiError>({ error, ...extra }, status);
}

export function preflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: ApiErrorCode,
    public extra: Omit<ApiError, "error"> = {},
  ) {
    super(code);
  }
}

/** Wrap a route handler: HttpError → JSON error, anything else → 500 without leaking details. */
export function handle(fn: (req: Request) => Promise<NextResponse>) {
  return async (req: Request): Promise<NextResponse> => {
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return apiError(e.status, e.code, e.extra);
      console.error("[swen api]", e);
      return apiError(500, "server_error");
    }
  };
}

export async function readJson(req: Request, maxBytes = 2_000_000): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "bad_request", { message: "Body too large" });
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "bad_request", { message: "Invalid JSON" });
  }
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  const m = h ? /^Bearer\s+(.+)$/i.exec(h) : null;
  return m ? m[1]!.trim() : null;
}
