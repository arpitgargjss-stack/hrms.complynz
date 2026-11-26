/**
 * Shrink a phone photo before upload. Camera images are often 3 to 8 MB each; resizing the long edge to
 * 2000px and re-encoding as JPEG keeps documents readable at a fraction of the size (usually under 600 KB).
 * PDFs and small images pass through untouched, and if re-encoding would not help we keep the original.
 */
const SHRINKABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function shrinkImage(file: File, opts: { maxEdge?: number; quality?: number; skipBelow?: number } = {}): Promise<{ blob: Blob; mime: string; name: string }> {
  const { maxEdge = 2000, quality = 0.85, skipBelow = 700 * 1024 } = opts;
  const original = { blob: file as Blob, mime: file.type, name: file.name };
  if (!SHRINKABLE.has(file.type)) return original;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size <= skipBelow) { bmp.close?.(); return original; }
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); // PNG transparency becomes white, not black, in JPEG
    ctx.drawImage(bmp, 0, 0, w, h); bmp.close?.();
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return original;
    return { blob, mime: "image/jpeg", name: file.name.replace(/\.(png|jpe?g|webp|heic)$/i, "") + ".jpg" };
  } catch { return original; }
}

/** Human-readable size, e.g. "3.4 MB". */
export function fmtSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
