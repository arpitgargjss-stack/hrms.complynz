/**
 * TEMPORARY, for testing only: lets HR admins (and super admins) unlock a locked payroll run.
 * To remove the feature: delete this file, the "TEMP: payroll unlock" route in server/routes/payroll.ts
 * and the "TEMP: payroll unlock" button block in client/src/pages/Payroll.tsx. Set this to false to
 * switch it off without removing code (the route then answers 404 and the button is hidden).
 */
export const PAYROLL_UNLOCK_ENABLED = true;
