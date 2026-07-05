// CONTRAST (not the MailKite path — a faithful sketch of the Postal one).
// Postal is an open-source mail server YOU self-host (VPS, MariaDB, Caddy, DNS, TLS,
// PTR/rDNS, IP warmup, blocklist monitoring, patching). Its incoming route → HTTP
// endpoint POSTs a processed message payload — parsed, but with two costs an agent
// feels: (1) attachments arrive base64-inline, so you decode the message parts
// yourself; and (2) there is NO normalized { spf, dkim, dmarc } verdict — the ready
// signal is `spam_status`, an rspamd Spam/NotSpam label, and the aligned auth result
// lives only in the raw `Authentication-Results` header, so you parse it yourself.
//
// See ../server.mjs for the one field (event.auth) that replaces all of it, and
// ../server.test.mjs for the two tests: you decode the base64 parts yourself, and
// `spam_status` is not an auth verdict (a non-spammy forgery still scores "trusted").

// Postal delivers attachments base64-inline in the payload. There's no signed URL and
// no ready Buffer — you decode each part yourself before your agent can touch a file.
export function decodeAttachments(payload) {
  return (payload.attachments ?? []).map((a) => ({
    filename: a.filename,
    contentType: a.content_type,
    buffer: Buffer.from(a.data ?? "", "base64"),
  }));
}

// The trust signal Postal actually hands you: `spam_status` (rspamd Spam/NotSpam).
// It is NOT sender authentication — it can't tell an aligned SPF/DKIM/DMARC pass from
// a non-spammy forgery. So `basis` is "spam_status", and there is no spf/dkim/dmarc
// field to weight. This is the gap event.auth closes.
export function deriveTrust(payload) {
  return { trusted: payload.spam_status === "NotSpam", basis: "spam_status" };
}

// The real verdict an agent should weight lives only in the raw Authentication-Results
// header. To get it on Postal you parse it yourself — the work MailKite does at the
// edge. (Header formats vary by upstream relay; this is a sketch, not a hardened parser.)
export function parseAuthResults(payload) {
  const raw = payload.headers?.["Authentication-Results"] ?? payload.authentication_results ?? "";
  return {
    spf: /spf=pass/i.test(raw),
    dkim: /dkim=pass/i.test(raw),
    dmarc: /dmarc=pass/i.test(raw),
  };
}

// A Postal incoming-route handler: derive a (weak) trust signal from spam_status,
// decode the base64 attachments yourself, run the agent, then reply through Postal's
// *own send API* — which only works because you keep that server, its IP reputation,
// and its DNS healthy. In-Reply-To / References are yours to set for threading.
export async function handlePostalInbound(payload, { runAgent, sendViaPostal }) {
  const trust = deriveTrust(payload);            // spam_status only — not an auth verdict
  const files = decodeAttachments(payload);      // you decode the base64 parts yourself

  const answer = await runAgent({
    task: payload.plain_body ?? "",
    from: payload.mail_from,
    trusted: trust.trusted,
    files,
  });

  // Reply via your own Postal box's send API. You host the auth and the server behind it.
  await sendViaPostal({
    to: [payload.mail_from],
    from: payload.rcpt_to,
    subject: `Re: ${payload.subject}`,
    html_body: answer.html,
  });
}
