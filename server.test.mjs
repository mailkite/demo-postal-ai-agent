import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { MailKite } from "mailkite";
import { verifySignature } from "./raw-server.mjs";
import { decodeAttachments, deriveTrust, parseAuthResults } from "./postal-contrast/handler.mjs";

const SECRET = "whsec_test";
const body = JSON.stringify({ type: "email.received" });
const t = 1_750_000_000_000; // ms since epoch — the unit MailKite signs with
const sign = (secret, ts, raw) =>
  `t=${ts},v1=${createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex")}`;

test("accepts a valid signature within tolerance", () => {
  assert.equal(verifySignature(sign(SECRET, t, body), body, SECRET, t + 10_000), true);
});

test("rejects a wrong secret", () => {
  assert.equal(verifySignature(sign("whsec_other", t, body), body, SECRET, t + 10_000), false);
});

test("rejects a tampered body", () => {
  assert.equal(verifySignature(sign(SECRET, t, body), body + " ", SECRET, t + 10_000), false);
});

test("rejects a stale timestamp (replay)", () => {
  assert.equal(verifySignature(sign(SECRET, t, body), body, SECRET, t + 3_600_000), false);
});

test("rejects malformed headers", () => {
  assert.equal(verifySignature("v1=deadbeef", body, SECRET, t), false);
  assert.equal(verifySignature(undefined, body, SECRET, t), false);
});

test("SDK and raw implementations agree on a fresh valid signature", () => {
  const nowMs = Date.now();
  const header = sign(SECRET, nowMs, body);
  assert.equal(MailKite.verifyWebhook(header, body, SECRET), true);
  assert.equal(verifySignature(header, body, SECRET, nowMs), true);
  assert.equal(MailKite.verifyWebhook(header, body + "x", SECRET), false);
});

// ── The Postal contrast, made concrete ───────────────────────────────────────
// MailKite hands the agent event.auth and attachments as signed URLs. Postal — a mail
// server you self-host — POSTs a processed payload with two costs (postal-contrast/
// handler.mjs): you decode the base64 message parts yourself, and there is no
// normalized auth verdict — `spam_status` is not sender authentication, so a
// non-spammy forgery still scores "trusted" unless you parse Authentication-Results.

test("Postal: you decode the base64 message parts yourself (no signed URL)", () => {
  // Postal delivers attachments base64-inline. There's no Buffer and no signed URL;
  // the decode is your job before the agent can touch the file. MailKite hands a URL.
  const payload = {
    attachments: [
      { filename: "po.pdf", content_type: "application/pdf", data: Buffer.from("%PDF-1.4 bytes").toString("base64") },
    ],
  };
  const [file] = decodeAttachments(payload);
  assert.equal(file.filename, "po.pdf");
  assert.equal(file.buffer.toString("utf8"), "%PDF-1.4 bytes"); // you did the decode
});

test("Postal: spam_status is not an auth verdict — a non-spammy forgery scores trusted", () => {
  // The ready trust signal Postal hands you is `spam_status`, not { spf, dkim, dmarc }.
  // A forged sender whose message simply isn't spammy passes spam_status while SPF
  // actually failed — so the spam-only signal says "trusted" and the real auth verdict
  // (which you must parse from Authentication-Results yourself) says spf=fail. That gap
  // is what event.auth closes on MailKite.
  const forged = {
    spam_status: "NotSpam",
    headers: { "Authentication-Results": "postal.yourco.dev; spf=fail; dkim=fail; dmarc=fail" },
  };
  assert.equal(deriveTrust(forged).trusted, true);        // spam_status says trust it
  assert.equal(parseAuthResults(forged).spf, false);      // the real verdict: SPF failed
  assert.equal(forged.spf, undefined);                    // there is no ready auth field
});
