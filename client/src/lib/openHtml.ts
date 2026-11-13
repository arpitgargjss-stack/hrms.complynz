// Opens an authenticated API resource in a new tab via a blob URL (the token never goes in a URL).
async function bearer(): Promise<string | null> {
  try {
    const c = (window as unknown as { Clerk?: { session?: { getToken: () => Promise<string | null> } } }).Clerk;
    return (await c?.session?.getToken()) ?? null;
  } catch { return null; }
}
export async function openAuthed(path: string, forceType?: string): Promise<void> {
  const w = window.open("", "_blank"); // open synchronously so popup blockers allow it
  try {
    const token = await bearer();
    const res = await fetch("/api" + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error((j as { error?: string }).error ?? res.statusText); }
    const blob = new Blob([await res.arrayBuffer()], { type: forceType ?? res.headers.get("Content-Type") ?? "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    if (w) w.location.href = url; else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) { w?.close(); throw e; }
}
export const openHtml = (path: string) => openAuthed(path, "text/html");
