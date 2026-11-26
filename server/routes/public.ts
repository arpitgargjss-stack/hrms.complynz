import { Router, type Request } from "express";
import { z } from "zod";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { wrap, parse, HttpError } from "./util";
import { logAudit } from "../lib/audit";
import { encryptField, hmac, newOtp, safeEqualHex, sha256 } from "../lib/crypto";
import { saveFile } from "../lib/files";
import { sendEmail } from "../lib/email";
import { renderLetter } from "../lib/letterHtml";
import { letterContext } from "../lib/letterContext";
import { param, dateStr, parseOut } from "../lib/routeHelpers";
import {
  RateLimiter, canSendOtp, checkSession, evaluateOtp, makeSession, maskEmail, OTP_TTL_MS, type OtpState,
} from "../lib/otpLogic";
import { CONSENT_PURPOSES } from "../../shared/hr/misc";

/**
 * Public, token-gated routes (no staff login, no cookies). Rules: never log tokens, emails or OTPs;
 * errors are generic so they do not reveal whether a token exists.
 */
const r = Router();
const A = schema;
const limiter = new RateLimiter();
const sendLog = new Map<string, number[]>();
const GENERIC = "This link or code is invalid or has expired";

const tokenHashOf = (token: string) => (token.length >= 20 && token.length <= 100 ? sha256(token) : sha256("invalid:" + token.slice(0, 100)));
function guard(req: Request, tokenHash: string) {
  const ip = req.ip ?? "unknown";
  if (!limiter.hit(`ip:${ip}`, 300, 10 * 60_000) || !limiter.hit(`it:${ip}:${tokenHash}`, 40, 10 * 60_000)) throw new HttpError(429, "Too many requests. Please try again later.");
}
function allowSend(kind: string, tokenHash: string): boolean {
  if (sendLog.size > 20000) sendLog.clear();
  const key = kind + tokenHash;
  const d = canSendOtp(sendLog.get(key) ?? [], Date.now());
  sendLog.set(key, d.sends);
  return d.allowed;
}
const otpHashOf = (otp: string, tokenHash: string) => hmac(otp, `otp:${tokenHash}`);
const NOT_YET_SENT = { sent: true };
const otpBody = z.object({ otp: z.string().regex(/^\d{6}$/) });
const hdr = (req: Request, name: string) => { const v = req.headers[name]; return typeof v === "string" ? v : undefined; };

const SEND_FAILED = "We couldn't send the code right now. Please try again in a few minutes, or contact HR if it keeps failing.";
/** Sends the code. Returns false when the email provider did not accept it (the reason is logged by sendEmail). */
async function sendOtpEmail(to: string, otp: string): Promise<boolean> {
  return sendEmail({ to, subject: "Your Complynz verification code", text: `Your verification code is ${otp}. It is valid for 10 minutes. If you did not request it, ignore this email.` });
}

// ================= offer / letter acceptance =================
const signAccept = (s: string) => hmac(s, "accept-session");
async function loadLink(token: string) {
  const th = tokenHashOf(token);
  const [link] = await db.select().from(A.acceptanceLinks).where(eq(A.acceptanceLinks.tokenHash, th)).limit(1);
  if (!link || link.expiresAt.getTime() <= Date.now()) return { th, link: null };
  return { th, link };
}

r.get("/accept/:token", wrap(async (req, res) => {
  const th = tokenHashOf(param(req, "token")); guard(req, th);
  const { link } = await loadLink(param(req, "token"));
  if (!link) return res.json({ valid: false });
  res.json({ valid: true, maskedEmail: maskEmail(link.recipientEmail), accepted: !!link.acceptedAt });
}));

r.post("/accept/:token/otp", wrap(async (req, res) => {
  const th = tokenHashOf(param(req, "token")); guard(req, th);
  if (!allowSend("a", th)) throw new HttpError(429, "Too many codes requested. Please try again in an hour.");
  const { link } = await loadLink(param(req, "token"));
  if (!link || link.acceptedAt) return res.json(NOT_YET_SENT);
  const otp = newOtp();
  await db.update(A.acceptanceLinks).set({ otpHash: otpHashOf(otp, th), otpExpiresAt: new Date(Date.now() + OTP_TTL_MS), otpAttempts: 0 }).where(eq(A.acceptanceLinks.id, link.id));
  if (!(await sendOtpEmail(link.recipientEmail, otp))) {
    await db.update(A.acceptanceLinks).set({ otpHash: null, otpExpiresAt: null }).where(eq(A.acceptanceLinks.id, link.id));
    console.error("accept OTP email failed; told the candidate to retry");
    throw new HttpError(502, SEND_FAILED);
  }
  res.json(NOT_YET_SENT);
}));

/** Checks the OTP against the link row, persisting the attempt counter. Returns true on success. */
async function checkAcceptOtp(link: typeof A.acceptanceLinks.$inferSelect, th: string, otp: string): Promise<boolean> {
  const state: OtpState = { otpHash: link.otpHash, otpExpiresAt: link.otpExpiresAt, attempts: link.otpAttempts };
  const out = evaluateOtp(state, otpHashOf(otp, th), new Date(), safeEqualHex);
  if (out.attempts !== link.otpAttempts) await db.update(A.acceptanceLinks).set({ otpAttempts: out.attempts }).where(eq(A.acceptanceLinks.id, link.id));
  return out.result === "ok";
}

r.post("/accept/:token/verify-otp", wrap(async (req, res) => {
  const th = tokenHashOf(param(req, "token")); guard(req, th);
  const b = parse(otpBody, req.body);
  const { link } = await loadLink(param(req, "token"));
  if (!link || link.acceptedAt || !(await checkAcceptOtp(link, th, b.otp))) throw new HttpError(400, GENERIC);
  res.json({ session: makeSession(th, Date.now(), signAccept) });
}));

async function renderSet(letterId: string) {
  const [first] = await db.select().from(A.letters).where(eq(A.letters.id, letterId)).limit(1);
  if (!first) return { letters: [] as { id: string; type: string; refNo: string; html: string }[], html: "", contentHash: sha256("") };
  let set = [first];
  if (first.candidateId) {
    set = await db.select().from(A.letters).where(and(eq(A.letters.candidateId, first.candidateId), inArray(A.letters.type, ["offer_short", "offer_full"]), inArray(A.letters.status, ["issued", "accepted"]))).orderBy(asc(A.letters.type));
    if (!set.length) set = [first];
  }
  let name = "";
  if (first.candidateId) { const [c] = await db.select({ n: A.candidates.fullName }).from(A.candidates).where(eq(A.candidates.id, first.candidateId)).limit(1); name = c?.n ?? ""; }
  else if (first.employeeId) { const [e] = await db.select({ n: A.employees.fullName }).from(A.employees).where(eq(A.employees.id, first.employeeId)).limit(1); name = e?.n ?? ""; }
  const letters = await Promise.all(set.map(async (l) => { const payload = (l.payload ?? {}) as Record<string, unknown>; return { id: l.id, type: l.type, refNo: l.refNo, html: renderLetter({ type: l.type, refNo: l.refNo, name, issuedAt: l.issuedAt, status: "issued", payload, approvedAt: l.approvedAt, ...(await letterContext({ type: l.type, payload })) }) }; }));
  const html = letters.map((l) => l.html).join("\n");
  return { letters, html, contentHash: sha256(html), nameNormalised: name.trim().toLowerCase().replace(/\s+/g, " ") };
}

r.get("/accept/:token/letter", wrap(async (req, res) => {
  const th = tokenHashOf(param(req, "token")); guard(req, th);
  const { link } = await loadLink(param(req, "token"));
  if (!link || !checkSession(hdr(req, "x-accept-session"), th, Date.now(), signAccept, safeEqualHex)) throw new HttpError(400, GENERIC);
  const set = await renderSet(link.letterId);
  res.json({ letters: set.letters.map((l) => ({ id: l.id, type: l.type, refNo: l.refNo, html: l.html })), html: set.html, consentPurposes: CONSENT_PURPOSES, accepted: !!link.acceptedAt });
}));

const consentKeys = CONSENT_PURPOSES.map((c) => c.key) as [string, ...string[]];
const verifyBody = z.object({
  otp: z.string().regex(/^\d{6}$/).optional(),
  // Every purpose needs an explicit yes or no; nothing is assumed.
  consents: z.record(z.enum(consentKeys), z.boolean()).refine((c) => consentKeys.every((k) => typeof c[k] === "boolean"), "Choose yes or no for each data purpose"),
  agree: z.literal(true), typedName: z.string().trim().min(2).max(120),
});

r.post("/accept/:token/verify", wrap(async (req, res) => {
  const th = tokenHashOf(param(req, "token")); guard(req, th);
  const b = parseOut(verifyBody, req.body);
  const { link } = await loadLink(param(req, "token"));
  if (!link || link.acceptedAt) throw new HttpError(400, GENERIC);
  const viaSession = checkSession(hdr(req, "x-accept-session"), th, Date.now(), signAccept, safeEqualHex);
  if (!viaSession && !(b.otp && (await checkAcceptOtp(link, th, b.otp)))) throw new HttpError(400, GENERIC);

  const set = await renderSet(link.letterId);
  const subjectId = "cand_" + hmac(th, "subject").slice(0, 24);
  const now = new Date();
  const ok = await db.transaction(async (tx) => {
    const done = await tx.update(A.acceptanceLinks).set({ acceptedAt: now, contentHash: set.contentHash, otpHash: null, otpExpiresAt: null })
      .where(and(eq(A.acceptanceLinks.id, link.id), isNull(A.acceptanceLinks.acceptedAt))).returning({ id: A.acceptanceLinks.id });
    if (!done.length) return false;
    const ids = set.letters.map((l) => l.id);
    if (ids.length) await tx.update(A.letters).set({ status: "accepted" }).where(inArray(A.letters.id, ids));
    const [first] = await tx.select({ c: A.letters.candidateId }).from(A.letters).where(eq(A.letters.id, link.letterId)).limit(1);
    if (first?.c) await tx.update(A.candidates).set({ status: "accepted" }).where(eq(A.candidates.id, first.c));
    const events = CONSENT_PURPOSES.filter((c) => c.key in (b.consents as object)).map((c) => ({
      subjectId, purposeKey: c.key, status: (b.consents as Record<string, boolean>)[c.key] ? "granted" : "withdrawn", noticeVersion: "offer-v1", source: "offer_acceptance",
    }));
    if (events.length) await tx.insert(A.consentEvents).values(events);
    return true;
  });
  if (!ok) throw new HttpError(400, GENERIC);
  const typed = b.typedName.trim().toLowerCase().replace(/\s+/g, " ");
  await logAudit(`candidate:${subjectId}`, "offer.accept", "acceptance_link", link.id, { contentHash: set.contentHash, letters: set.letters.map((l) => l.refNo), typedNameMatches: typed === set.nameNormalised, consentsRecorded: Object.keys(b.consents).length });
  res.json({ accepted: true, acceptedAt: now.toISOString(), contentHash: set.contentHash });
}));

// ================= onboarding =================
const signOnb = (s: string) => hmac(s, "onboard-session");
const onbOtps = new Map<string, OtpState>();

async function loadOnb(token: string) {
  const th = tokenHashOf(token);
  const [link] = await db.select().from(A.onboardingLinks).where(eq(A.onboardingLinks.tokenHash, th)).limit(1);
  if (!link || link.expiresAt.getTime() <= Date.now()) return { th, link: null, cand: null };
  const [cand] = await db.select().from(A.candidates).where(eq(A.candidates.id, link.candidateId)).limit(1);
  return { th, link, cand: cand ?? null };
}

r.get("/onboarding/:token", wrap(async (req, res) => {
  const th = tokenHashOf(param(req, "token")); guard(req, th);
  const { link, cand } = await loadOnb(param(req, "token"));
  if (!link || !cand) return res.json({ valid: false });
  res.json({ valid: true, maskedEmail: maskEmail(cand.email), steps: link.steps, completed: !!link.completedAt });
}));

r.post("/onboarding/:token/otp", wrap(async (req, res) => {
  const th = tokenHashOf(param(req, "token")); guard(req, th);
  if (!allowSend("o", th)) throw new HttpError(429, "Too many codes requested. Please try again in an hour.");
  const { link, cand } = await loadOnb(param(req, "token"));
  if (!link || !cand || link.completedAt) return res.json(NOT_YET_SENT);
  const otp = newOtp();
  if (onbOtps.size > 5000) onbOtps.clear();
  onbOtps.set(th, { otpHash: otpHashOf(otp, th), otpExpiresAt: new Date(Date.now() + OTP_TTL_MS), attempts: 0 });
  if (!(await sendOtpEmail(cand.email, otp))) {
    onbOtps.delete(th);
    console.error("onboarding OTP email failed; told the candidate to retry");
    throw new HttpError(502, SEND_FAILED);
  }
  res.json(NOT_YET_SENT);
}));

r.post("/onboarding/:token/verify-otp", wrap(async (req, res) => {
  const th = tokenHashOf(param(req, "token")); guard(req, th);
  const b = parse(otpBody, req.body);
  const { link } = await loadOnb(param(req, "token"));
  const st = onbOtps.get(th);
  if (!link || link.completedAt || !st) throw new HttpError(400, GENERIC);
  const out = evaluateOtp(st, otpHashOf(b.otp, th), new Date(), safeEqualHex);
  onbOtps.set(th, { ...st, attempts: out.attempts });
  if (out.result !== "ok") throw new HttpError(400, GENERIC);
  res.json({ session: makeSession(th, Date.now(), signOnb) });
}));

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const submitBody = z.object({
  personal: z.object({
    fullName: z.string().trim().min(2).max(120), dob: dateStr.optional(), gender: z.enum(["female", "male", "other", "undisclosed"]).optional(),
    phone: z.string().trim().regex(/^\+?[0-9 ]{8,15}$/).optional(), address: z.string().trim().max(500).optional(),
    // Printed in the NDA: "son/daughter/spouse of ..." and "Aadhaar (last 4 digits) ...". Only the last 4 Aadhaar digits are ever taken.
    relationName: z.string().trim().min(2, "Enter your father's, mother's or spouse's name").max(120), aadhaarLast4: z.string().trim().regex(/^\d{4}$/, "Enter only the last 4 digits of your Aadhaar"),
  }),
  pan: z.string().trim().toUpperCase().regex(PAN_RE, "Invalid PAN").optional(),
  bank: z.object({
    bankName: z.string().trim().min(2).max(100), accountNumber: z.string().trim().regex(/^\d{9,18}$/, "Invalid account number"),
    ifsc: z.string().trim().toUpperCase().regex(IFSC_RE, "Invalid IFSC"),
  }).optional(),
  documents: z.array(z.object({
    kind: z.enum(["pan", "aadhaar", "bank_proof", "photo", "other"]), name: z.string().trim().min(1).max(120),
    mime: z.string().max(60), dataBase64: z.string().max(14_500_000),
  })).max(7).default([]),
});

r.post("/onboarding/:token/submit", wrap(async (req, res) => {
  const th = tokenHashOf(param(req, "token")); guard(req, th);
  if (!checkSession(hdr(req, "x-onboard-session"), th, Date.now(), signOnb, safeEqualHex)) throw new HttpError(400, GENERIC);
  const b = parseOut(submitBody, req.body);
  const { link, cand } = await loadOnb(param(req, "token"));
  if (!link || !cand || link.completedAt) throw new HttpError(400, GENERIC);
  const steps = (link.steps as string[]) ?? [];
  if (steps.includes("kyc") && !b.pan) throw new HttpError(400, "PAN is required");
  if (steps.includes("bank") && !b.bank) throw new HttpError(400, "Bank details are required");
  if (steps.includes("bank") && !b.documents.some((d) => d.kind === "bank_proof")) throw new HttpError(400, "Upload a cancelled cheque, passbook page or mobile banking screenshot showing your account number");

  const documents: { fileId: string; kind: string; name: string }[] = [];
  for (const d of b.documents) {
    try {
      const f = await saveFile({ kind: d.kind, buf: Buffer.from(d.dataBase64, "base64"), name: d.name, mime: d.mime, uploadedBy: "candidate" });
      documents.push({ fileId: f.id, kind: d.kind, name: f.originalName });
    } catch { throw new HttpError(400, "A document was rejected: use PDF, PNG, JPEG or WebP up to 10 MB"); }
  }
  const submitted = {
    personal: b.personal,
    panEnc: b.pan ? encryptField(b.pan) : undefined,
    bankName: b.bank?.bankName, accountEnc: b.bank ? encryptField(b.bank.accountNumber) : undefined, ifsc: b.bank?.ifsc,
    documents, submittedAt: new Date().toISOString(),
  };
  const done = await db.update(A.onboardingLinks).set({ submitted, completedAt: new Date() })
    .where(and(eq(A.onboardingLinks.id, link.id), isNull(A.onboardingLinks.completedAt))).returning({ id: A.onboardingLinks.id });
  if (!done.length) throw new HttpError(400, GENERIC);
  onbOtps.delete(th);
  await logAudit(`candidate:cand_${hmac(th, "subject").slice(0, 24)}`, "onboarding.submit", "onboarding_link", link.id, { documents: documents.length });
  res.json({ submitted: true });
}));

void sql;
export default r;
