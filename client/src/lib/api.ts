import { useAuth } from "@clerk/clerk-react";

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

let getToken: (() => Promise<string | null>) | null = null;
const HAS_CLERK = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
function useClerkBind() { const a = useAuth(); getToken = () => a.getToken(); }
// HAS_CLERK is a build-time constant, so the hook order never changes between renders.
export const useBindAuth: () => void = HAS_CLERK ? useClerkBind : () => {};

export async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const token = getToken ? await getToken() : null;
  const res = await fetch("/api" + path, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new ApiError(res.status, (j as { error?: string }).error ?? res.statusText); }
  return res.json() as Promise<T>;
}
export async function publicApi<T = unknown>(path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }): Promise<T> {
  const res = await fetch("/api/public" + path, { method: init?.method ?? (init?.body ? "POST" : "GET"), headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers }, body: init?.body ? JSON.stringify(init.body) : undefined });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new ApiError(res.status, (j as { error?: string }).error ?? "Request failed"); }
  return res.json() as Promise<T>;
}
export async function fileToBase64(f: Blob): Promise<string> {
  const buf = new Uint8Array(await f.arrayBuffer()); let s = ""; buf.forEach((b) => (s += String.fromCharCode(b))); return btoa(s);
}
export async function getAuthToken(): Promise<string | null> { return getToken ? await getToken() : null; }
/** POST JSON and get text back (used for letter previews). */
export async function apiText(path: string, body: unknown): Promise<string> {
  const token = getToken ? await getToken() : null;
  const res = await fetch("/api" + path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new ApiError(res.status, (j as { error?: string }).error ?? res.statusText); }
  return res.text();
}
