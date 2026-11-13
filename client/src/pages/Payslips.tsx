import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { openHtml } from "../lib/openHtml";
import { Card, ErrorNote, Page, inr } from "../lib/ui";

type Slip = { id: string; month: string; paidDays: number; calendarDays: number; netPayPaise: number };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

export default function Payslips() {
  const q = useQuery({ queryKey: ["my-payslips"], queryFn: () => api<Slip[]>("/me/payslips") });
  const [err, setErr] = useState<string | null>(null);
  const open = (id: string) => { setErr(null); openHtml(`/payslips/${id}/html`).catch((e) => setErr((e as Error).message)); };
  return (
    <Page title="My payslips">
      <Card>
        <p className="k">Payslips appear here after payroll for the month is locked. Use View, then print or save as PDF from your browser.</p>
        <ErrorNote error={q.error} />
        {err && <div className="note bad" role="alert">{err}</div>}
        {q.isLoading ? <p>Loading…</p> : !q.data?.length ? <p>No payslips yet.</p> : (
          <div style={{ overflowX: "auto" }}><table className="t"><thead><tr><th>Month</th><th>Paid days</th><th>Net pay</th><th></th></tr></thead><tbody>
            {q.data.map((s) => (
              <tr key={s.id}><td>{monthLabel(s.month)}</td><td>{s.paidDays} of {s.calendarDays}</td><td>{inr(s.netPayPaise)}</td>
                <td><button className="btn p" onClick={() => open(s.id)} aria-label={`View payslip for ${monthLabel(s.month)}`}>View / print</button></td></tr>
            ))}
          </tbody></table></div>
        )}
      </Card>
    </Page>
  );
}
