# Plan: Admin configuration

Status: phases 1 to 5 built on 22 November 2026 (not committed). DOCX upload skipped: adding a new dependency (mammoth) was not permitted in this session. Asked for by AG on 22 November 2026.

## Decisions (AG, 22 November 2026)

- **CEO approval before publishing a policy: yes.** Same flow as letters today: HR saves a draft, sends it for
  approval (`pending_approval`), the CEO (super admin) approves or sends it back with a note, and only an
  approved version can be published. A super admin's own draft can be approved straight from the approvals list.
- **Placeholders are a fixed set.** Only the keys defined in the registry can be used; HR cannot invent new ones.
  Adding a placeholder is a code change with a test.
- **Who can edit configuration: HR admin, finance admin (`finance_signatory`) and super admin, for now.** All three can
  edit every section. Super admin already implies the other two roles. A new permission `settings.manage` is granted
  to `hr_admin` and `finance_signatory` in `shared/hr/access.ts`, with a test. Publishing a policy still needs CEO approval.
- **Employees only view and acknowledge.** They see the exact version they are asked to acknowledge, with a
  single "I have read and accept" acknowledgement (no e-signature or OTP).

## Goal

One admin page, **Admin → Settings → Configuration**, where HR sets up everything the platform runs on:
company details, committees and named people (for example the 4 POSH Internal Committee members),
policies and their versions, reimbursement rules, onboarding steps, salary structures, leave types and
letter/email templates. Policies become templates with **placeholders** (`{{posh.ic.presiding_officer.name}}`)
that are filled from these settings, so changing a name in one place updates every policy that uses it.

## What exists today (and stays the source of truth)

These are already stored in the database, but each is edited on a different page:

| Area | Table | Edited today in |
| --- | --- | --- |
| Company details (legal name, CIN, address, signatory, grievance officer, courts) | `hr_company_profile` (versioned jsonb) | Letters |
| Compliance facts (entity, turnover, GST, DPIIT, FDI, MSME) | `hr_compliance_profile` | Compliance → Company profile |
| Policies, versions, acknowledgements | `hr_policies`, `hr_policy_versions`, `hr_policy_acks` | Policies (upload HTML) |
| Reimbursement rules | `hr_reimbursement_policy` (versioned jsonb) | Reimbursements |
| Salary structures and statutory rules | `hr_salary_templates`, `hr_statutory_rules` | Payroll tabs |
| Leave types, work calendar, holidays | `hr_leave_types`, `hr_work_calendar`, `hr_holidays` | Leave / Attendance |
| Onboarding steps | stored per link in `hr_onboarding_links.steps` | Hiring (per candidate) |
| Email templates | `hr_email_templates` | not editable in the UI |
| Full and final rules | `hr_fnf_rules` | Full and final |

The hub does not copy these. It is one place that **links to or embeds** the existing editors, plus three new things:
named roles and committees, policy placeholders, and a default onboarding checklist.

## Information architecture

`/admin/config`, for HR admin, finance admin and super admin. A left rail of sections and a status
summary at the top ("3 settings missing: POSH presiding officer, CIN, signatory").

1. **Company**: legal details, registered address, CIN, signatory with signature/stamp, offices (links to Organisation).
2. **People and committees** (new): POSH Internal Committee (presiding officer, members, external member, term
   dates, with checks that there are at least 4 members, at least half are women and there is one external
   member), grievance officer, DPO, nodal officer, HR contact, emergency contacts. Members are picked from People
   or typed in (external member).
3. **Policies**: list with version, status (draft / published), acknowledgement %, and the placeholders each one
   uses. Actions: upload (HTML, DOCX import later), edit in the browser, preview with real values, send for CEO
   approval, publish the approved version (asks everyone to re-acknowledge), archive. Starter templates: POSH, code of conduct, leave,
   reimbursement, IT and data use, DPDP privacy notice.
4. **Pay and money**: salary structures, statutory rules, reimbursement policy, full and final rules (existing editors, moved here).
5. **Time off**: leave types, holiday calendar, work week (existing editors).
6. **Onboarding** (new default): checklist of documents and steps (PAN, Aadhaar, bank, address proof, NDA,
   policy acknowledgements). New onboarding links copy this default; HR can still edit one candidate's list.
7. **Templates**: letter defaults and email templates (subject and body with placeholders).
8. **Placeholders**: read-only reference of every placeholder, its current value, and where it is used.

## Placeholders

- Syntax: `{{group.key}}`, for example `{{company.legal_name}}`, `{{posh.ic.presiding_officer.name}}`,
  `{{posh.ic.members}}` (renders a table), `{{reimbursement.meal_limit}}`, `{{leave.casual.days}}`.
- One registry in `shared/hr/placeholders.ts`: key, label, type (text, person, people list, money, date),
  where the value comes from (company profile, committee, reimbursement policy, leave types) and an example.
  Unit tests check that every key resolves and every policy only uses known keys.
- Rendering happens on the server at publish time: the version stores both the template and the rendered HTML,
  so an acknowledged version never changes. When a value changes (for example a new POSH member), the policies
  that use it are flagged **"Out of date: re-publish"**, and one click publishes a new version.
- Unknown or empty placeholders block publishing and are listed ("POSH presiding officer is not set").
- Output is sanitised with the existing `sanitizeHtml`; values are escaped.

## Data model changes (one migration, local preview DB first)

- `hr_org_roles`: role key (`posh_presiding`, `posh_member`, `posh_external`, `grievance_officer`, `dpo` …),
  employee id or external name/email/phone, gender (for the POSH check), start and end dates, created by.
- `hr_policies`: add `category` (people, pay, conduct, data, onboarding), `owner`.
- `hr_policy_versions`: add `template` (with placeholders), `values` (jsonb snapshot used to render), `summary`,
  and the approval fields used by letters: `status` (draft, pending_approval, approved, published, rejected),
  `submitted_by/at`, `approved_by/at`, `review_note`. `current_version` on `hr_policies` moves only on publish.
- `hr_onboarding_template`: versioned jsonb default checklist (same pattern as the reimbursement policy).
- Keep the existing versioned-jsonb tables as they are.

## Permissions and audit

- Writes via `need(req, "settings.manage", "all")`, granted to `hr_admin` and `finance_signatory` (super admin implies both).
- Policy approval reuses the letters rule: only a super admin (CEO) can approve.
- Every change goes through `logAudit` with before and after values: `config.company.update`,
  `config.role.add` / `config.role.remove`, `policy.submit`, `policy.approve`, `policy.return`, `policy.publish`,
  `config.onboarding.update`.
- Personal data of external committee members is kept to name, email and phone, as DPDP requires.

## UI notes

Same professional style as Compliance: flat header, underline section tabs or a left rail, dense tables,
6px controls, no emojis. Every section shows "Last changed by … on …" and a version history.

## Phases

1. **Hub shell + Company + People and committees**: new page, sidebar entry under Settings, `hr_org_roles`,
   POSH committee with checks; the compliance POSH order template reads the members from here.
2. **Policy placeholders and CEO approval**: fixed registry, editor with insert-placeholder menu, preview,
   draft → CEO approval → publish-with-snapshot,
   "out of date" flag, starter templates for POSH and leave.
3. **Bring existing editors into the hub**: reimbursement, salary structures, statutory rules, leave types,
   holidays, F&F rules (move, do not rewrite); old pages link to the hub.
4. **Onboarding default checklist + email templates editor**.
5. Optional: DOCX upload converted to HTML, policy comparison between versions, reminders for pending acknowledgements.

## Open questions for AG

Answered: CEO approval (yes), placeholders (fixed set), employees (view and acknowledge only).
Answered: who can edit (HR admin, finance admin, super admin).
Still open:
1. DOCX upload in phase 2, or is in-browser editing enough to start?
2. Starter policy templates: which ones first (POSH, leave, code of conduct, reimbursement, IT use)?
