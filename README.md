# Complynz HRMS

Internal HRMS for Complynz staff, planned for `hr.complynz.com` (production only). Status: **first full build.** Backend, client and demo seeder exist and are type-checked and unit-tested. Not deployed; statutory rules are intentionally unconfigured.

## Contents

- `design/` — 27 UI boards (`*.dc.html`) plus `canvas.json` (layout index). They use masked sample data. Open them in the Claude Design canvas; each file loads `./support.js` from the canvas runtime, which is not included here.
- Published canvas: https://claude.ai/artifact/LCFvG8V9rCaSXhvjqNWU4M

## Scope

- People: employee master (codes `CMPZ###`), profile, org chart, document vault, reporting-manager changes, birthdays and anniversaries.
- Hiring: candidates, onboarding links, offer letters (short and full, link plus email OTP acceptance), departments, locations, designations.
- Payroll: admin-configured components and effective-dated statutory rules, integer paise, payroll runs, payslips, one-click signed bank advice (stamp and signature).
- Time: punch in/out with a one-time location check (inside/outside only), leave types, work calendar and holidays.
- Reimbursements: monthly claims with bill upload, policy checks, admin trends.
- Exits and performance: resignations, exit checklist, PIPs.
- Culture: policies viewer with acknowledgement, anonymous satisfaction survey (minimum 5 responses), suggestion box, asset tagging and contracts.
- Roles: HR admin, finance signatory, manager, team member, enforced server-side.
- Consent: Complynz's own CMP, six opt-in purposes.
- Privacy contact: dpo@complynz.com.

## Open items

- Confirm PF ceiling, TDS section and slabs from official sources before seeding any statutory values.
- Add the sixth consent row (birthday) to the offer letter Part B.
- City-grade expense caps for the reimbursement policy.
- Artwork files for the short offer letter.
- Legal review: OTP acceptance of NDA/IP, asset contract, PIP and resignation templates.
- Menus on the older admin boards (Main, BankAdvice, Employee, Policies, Settings) lack the later items.

## Running locally

Run these one at a time, in two terminals for the last pair. Leave the `#` comments out: zsh does not treat `#` as a comment unless `interactivecomments` is set, and a pasted `:5100` then aborts the line (`zsh: number expected`) so the API never starts.

```bash
cp .env.example .env
pnpm install
pnpm db:migrate
HR_APP_URL=http://localhost:5101 pnpm db:seed
HR_APP_URL=http://localhost:5101 AUTH_MODE=dev DEV_AUTH_EMAIL=you@complynz.com pnpm dev
pnpm dev:client
pnpm check && pnpm test
```

Fill in `DATABASE_URL`, `FIELD_ENCRYPTION_KEY`, and `HMAC_PEPPER`. Never commit `.env`. `pnpm db:seed` loads no-PII demo data and refuses to run when `HR_APP_URL` is the production host. The API listens on port 5100; Vite is on port 5101 and proxies `/api` there. `AUTH_MODE=dev` is rejected when `HR_APP_URL` is `https://hr.complynz.com`, so local dev must point that variable at `http://localhost:5101` (in `.env` or on the command).

Assign the first admin with SQL: `insert into hr_user_roles(email, role) values ('you@complynz.com', 'hr_admin');`

## Layout

- `shared/hr/` pure logic with tests: payroll engine, leave and calendar, reimbursement policy, bank advice, access model.
- `server/` Express API (`routes/`), drizzle schema (`db/schema.ts`), staff gate, encryption, audit. Public candidate routes are under `/api/public`.
- `client/` React app, one page per area.
- `migrations/` SQL.

## Before production

- Enter PF, TDS and Professional Tax rules with their source; none are seeded.
- Set the Clerk keys and keep `AUTH_MODE=clerk`. Set `FIELD_ENCRYPTION_KEY` and `HMAC_PEPPER` once and never rotate without a migration plan.
- Point `CMP_BASE_URL` at the real CMP API (the path in `server/lib/consentClient.ts` is a guess).
- Onboarding OTPs are in memory; persist them before running more than one instance.
- Legal review of templates (see Open items).
