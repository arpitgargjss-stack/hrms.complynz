import { Link } from "wouter";

/** A one-line pointer from an original settings page to the same editor in Admin configuration. */
export function ConfigHint({ tab, label }: { tab: string; label: string }) {
  return <p className="k" style={{ margin: "0 0 12px" }}>These settings are also in <Link href={`/admin/config?tab=${tab}`}>Configuration → {label}</Link>, with the rest of the company setup.</p>;
}
