import { useQuery } from "@tanstack/react-query";
import { getAuthToken } from "./api";

export const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

/** Photos are served from an authenticated endpoint, so fetch them with the bearer token and show a blob URL. */
export function usePhotoUrl(fileId: string | null | undefined) {
  return useQuery({
    queryKey: ["photo", fileId], enabled: !!fileId, staleTime: Infinity, gcTime: 30 * 60_000,
    queryFn: async () => {
      const token = await getAuthToken();
      const res = await fetch(`/api/files/${fileId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error("Photo unavailable");
      return URL.createObjectURL(await res.blob());
    },
  });
}

/** Round profile photo with an initials fallback. `src` overrides the stored photo (used for a local preview). */
export function Avatar({ name, fileId, src, size = 40 }: { name: string; fileId?: string | null; src?: string | null; size?: number }) {
  const q = usePhotoUrl(src ? null : fileId);
  const url = src ?? q.data;
  const base = { width: size, height: size, borderRadius: "50%", flex: `0 0 ${size}px` } as const;
  if (url) return <img src={url} alt={name} style={{ ...base, objectFit: "cover", background: "#e6eeff" }} />;
  return (
    <span role="img" aria-label={name} style={{ ...base, background: "#e6eeff", color: "#0039b8", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: Math.max(11, Math.round(size * 0.36)) }}>
      {initials(name)}
    </span>
  );
}

/** Centre-crop an image to a square JPEG (max 512px) so photos stay small. Falls back to the original file. */
export async function squarePhoto(file: File, max = 512): Promise<{ blob: Blob; mime: string }> {
  try {
    const bmp = await createImageBitmap(file);
    const side = Math.min(bmp.width, bmp.height), out = Math.min(max, side);
    const c = document.createElement("canvas"); c.width = out; c.height = out;
    c.getContext("2d")!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.88));
    if (blob) return { blob, mime: "image/jpeg" };
  } catch { /* fall through */ }
  return { blob: file, mime: file.type };
}
