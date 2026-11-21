import { useEffect, useState } from "react";
import { getAuthToken } from "./api";

// Photos are served from the authenticated /api/files/:id endpoint, so <img src> can't load them
// directly. Fetch each one once with the bearer token and keep a blob URL for the session.
const cache = new Map<string, Promise<string | null>>();
function loadPhoto(fileId: string): Promise<string | null> {
  let p = cache.get(fileId);
  if (!p) {
    p = (async () => {
      try {
        const token = await getAuthToken();
        const res = await fetch(`/api/files/${fileId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!res.ok) return null;
        const blob = await res.blob();
        return blob.type.startsWith("image/") ? URL.createObjectURL(blob) : null;
      } catch { return null; }
    })();
    cache.set(fileId, p);
  }
  return p;
}

export const initials = (n: string) => n.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";

const PALETTE = [["#e4e9fb", "#2438a8"], ["#e3f5ea", "#11663a"], ["#fff1cc", "#6e4a00"], ["#fde4e4", "#8a1c1c"], ["#efe4fb", "#5a24a8"], ["#e0f4f7", "#0e5d6b"], ["#fbe8dc", "#8a3f12"]];
export function hashColor(s: string): [string, string] {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length] as [string, string];
}

export function Avatar({ name, photoFileId, size = 40 }: { name: string; photoFileId?: string | null; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setSrc(null);
    if (photoFileId) loadPhoto(photoFileId).then((u) => { if (live) setSrc(u); });
    return () => { live = false; };
  }, [photoFileId]);
  const [bg, fg] = hashColor(name);
  const box = { width: size, height: size, borderRadius: "50%", flex: `0 0 ${size}px` } as const;
  if (src) return <img src={src} alt="" aria-hidden onError={() => setSrc(null)} style={{ ...box, objectFit: "cover", display: "block" }} />;
  return <span aria-hidden style={{ ...box, background: bg, color: fg, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: Math.round(size * 0.36) }}>{initials(name)}</span>;
}
