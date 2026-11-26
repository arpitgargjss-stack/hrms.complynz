import { useAuth } from "@clerk/clerk-react";

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

const TOO_LARGE = "The upload is too large. Please use smaller files (photos of documents are fine at a few hundred KB) and try again.";
/** Turn a failed response into a readable error. Proxies (nginx) answer 413 with an HTML page, not JSON. */
async function errorOf(res: Response, fallback: string): Promise<ApiError> {
  if (res.status === 413) return new ApiError(413, TOO_LARGE);
  const j = await res.json().catch(() => ({}));
  const msg = (j as { error?: string }).error;
  if (msg) return new ApiError(res.status, msg);
  if (res.status >= 500) return new ApiError(res.status, "The server had a problem. Please try again in a few minutes.");
  return new ApiError(res.status, fallback);
}
/** fetch, but a dropped connection becomes a readable error instead of "Failed to fetch". */
async function send(url: string, init: RequestInit): Promise<Response> {
  try { return await fetch(url, init); }
  catch { throw new ApiError(0, "Could not reach the server. Check your internet connection and try again."); }
}

let getToken: (() => Promise<string | null>) | null = null;
const HAS_CLERK = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
function useClerkBind() { const a = useAuth(); getToken = () => a.getToken(); }
// HAS_CLERK is a build-time constant, so the hook order never changes between renders.
export const useBindAuth: () => void = HAS_CLERK ? useClerkBind : () => {};

export async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const token = getToken ? await getToken() : null;
  const res = await send("/api" + path, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) throw await errorOf(res, res.statusText || "Request failed");
  return res.json() as Promise<T>;
}
export async function publicApi<T = unknown>(path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }): Promise<T> {
  const res = await send("/api/public" + path, { method: init?.method ?? (init?.body ? "POST" : "GET"), headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers }, body: init?.body ? JSON.stringify(init.body) : undefined });
  if (!res.ok) throw await errorOf(res, "Something went wrong. Please try again.");
  return res.json() as Promise<T>;
}
export async function fileToBase64(f: Blob): Promise<string> {
  // Chunked so multi-MB files do not build the string one byte at a time.
  const buf = new Uint8Array(await f.arrayBuffer()); let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
export async function getAuthToken(): Promise<string | null> { return getToken ? await getToken() : null; }
/** POST JSON and get text back (used for letter previews). */
export async function apiText(path: string, body: unknown): Promise<string> {
  const token = getToken ? await getToken() : null;
  const res = await send("/api" + path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  if (!res.ok) throw await errorOf(res, res.statusText || "Request failed");
  return res.text();
}
