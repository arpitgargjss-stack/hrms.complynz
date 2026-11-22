import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

type Rem = { slug: string; title: string; version: number; remindedAt: string };
/** In-app reminder from HR to acknowledge a policy; disappears once acknowledged. */
export function PolicyReminders() {
  const q = useQuery({ queryKey: ["policy-reminders"], queryFn: () => api<Rem[]>("/policies/reminders/mine") });
  if (!q.data?.length) return null;
  return <div role="status" style={{ border: "1px solid #fedf89", background: "#fffaeb", color: "#7a2e0e", borderRadius: 8, padding: "10px 14px", fontSize: 14, display: "flex", flexWrap: "wrap", gap: "4px 12px", alignItems: "center" }}>
    <b>HR has asked you to acknowledge:</b>
    {q.data.map((r) => <Link key={r.slug} href={`/policies/${r.slug}`} style={{ color: "#0039b8", fontWeight: 600 }}>{r.title}</Link>)}
  </div>;
}
