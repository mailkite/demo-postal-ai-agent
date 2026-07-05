# demo-postal-ai-agent

The runnable companion to [The Postal alternative for AI agents](https://mailkite.dev/blog/postal-for-ai-agents/).

Postal can receive mail — it's a mature open-source mail server, and an incoming route
POSTs your app a parsed message. The catch for an agent inbox is operational: you run the
whole box (VPS, MariaDB, Caddy, DNS, TLS, PTR/rDNS, IP warmup, blocklist monitoring,
patching). And the parsed payload gives you `spam_status`, not a normalized SPF/DKIM/DMARC
verdict — the aligned auth result lives in raw headers you parse yourself — with
attachments base64-inline you decode yourself, and the reply going back through your own
Postal box's send API. This repo runs the MailKite version of the same job — an email lands
at `agent@yourco.dev`, MailKite POSTs it already parsed **and authenticated**, a local agent
runs, and the reply threads back through one `mk.send()` — and puts the Postal path right
next to it in [`postal-contrast/`](./postal-contrast/handler.mjs) so you can see the
difference in code. It runs end to end with no MailKite account, no server, and no LLM: the
reply is a dry-run and the agent is a stub you swap for your model.

[![ci](https://github.com/mailkite/demo-postal-ai-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/mailkite/demo-postal-ai-agent/actions/workflows/ci.yml)

## Run it in one click

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/mailkite/demo-postal-ai-agent?file=server.mjs)
[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/mailkite/demo-postal-ai-agent?quickstart=1)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/mailkite/demo-postal-ai-agent)

StackBlitz runs the whole thing in your browser tab (WebContainers — real Node, no
account needed): open it and it boots the server, self-fires a correctly signed sample
event, and prints the round trip — zero setup, no domain, no mail server.

## Run it locally — one command

```sh
git clone https://github.com/mailkite/demo-postal-ai-agent
cd demo-postal-ai-agent
npm install     # mailkite + express
npm start       # boots the server, self-fires a signed email.received event, stays up
```

`npm start` prints the whole loop — the agent receives the task, reads the trust verdict
straight off `event.auth`, dry-runs the reply, and the server stays up for more:

```
listening on http://localhost:3000/hooks/agent

runAgent: task="Looks good — approved!" from=ada@example.com trusted=true
[dry-run] would reply { from: 'agent@yourco.dev', to: 'ada@example.com', subject: 'Re: invoice #1042' }

— self-fired one signed email.received event → 200 OK
  server's still up: POST your own events to :3000/hooks/agent, or point real email here.
```

A webhook needs a public URL in production; `npm start` sidesteps that by POSTing to its
own localhost, so the full loop runs anywhere. Want the halves separately? `npm run serve`
runs just the server, and `npm run fire-sample-event` fires the event from another
terminal. Set a real `MAILKITE_API_KEY` and the same code sends the reply for real instead
of dry-running it. Tamper with the body or the secret and the server answers `401`.

## The Postal contrast, in code (and in a test)

[`postal-contrast/handler.mjs`](./postal-contrast/handler.mjs) is a faithful sketch of the
Postal incoming-route path: read the processed payload, and — because there's no `auth`
field — derive trust from `spam_status` (an rspamd label, not sender authentication),
decode the base64 attachments yourself, and reply through your own Postal box's send API.
It's honest work. `npm test` names its two specific costs:

```
✔ Postal: you decode the base64 message parts yourself (no signed URL)
✔ Postal: spam_status is not an auth verdict — a non-spammy forgery scores trusted
```

That second test feeds it a forged sender whose message simply isn't spammy —
`spam_status: "NotSpam"` while SPF actually failed — and watches the spam-only signal
score it `trusted`, even though the real `Authentication-Results` says `spf=fail`. To catch
that on Postal you parse the raw header yourself. On MailKite that decision is one
normalized field, `event.auth`, computed at the edge — the whole reason
[`server.mjs`](./server.mjs) never opens a header, and never decodes an attachment.

`npm test` also runs the five webhook-signature cases (valid, wrong secret, tampered
body, replayed timestamp, malformed header) plus an SDK/raw parity check.

## The two ways to run the loop

- **[`server.mjs`](./server.mjs) — bring your own agent.** The webhook hits your
  endpoint, your model runs (here a stub `runAgent` that echoes the task), and you reply
  with `mk.send()`. This is the `?file=server.mjs` StackBlitz target and the code at the
  top of the post.
- **[`managed-route.mjs`](./managed-route.mjs) — hand it to a managed route.**
  `mk.createRoute({ match, action: "agent", agentPrompt })` points a route at MailKite's
  hosted runner: the model turns run for you on a durable queue with a per-run
  transcript, no endpoint and no server to host. Self-hosted Postal has no equivalent —
  you assemble the model and the send API yourself, on a box you also operate. Run with
  `npm run route-demo` (dry-runs unless `MAILKITE_API_KEY` is set).

## The rest

- [`fire-sample-event.mjs`](./fire-sample-event.mjs) — signs and POSTs the same payload
  shape MailKite's delivery worker sends (ms-timestamp HMAC), so the demo works with no
  account. The `auth` block is right in the payload.
- [`raw-server.mjs`](./raw-server.mjs) — **labeled raw alternative** (zero dependencies):
  hand-rolled HMAC-SHA256 over `"<t>.<rawBody>"` with a 5-minute replay window and
  constant-time compare — everything `MailKite.verifyWebhook` absorbs in one call.
- [`server.test.mjs`](./server.test.mjs) — signature vectors, SDK/raw parity, and the two
  Postal-contrast cost tests (`node --test`).

To point real email at it: [verify a domain on MailKite](https://mailkite.dev/docs/quickstart),
set your webhook URL to this server, and set `MAILKITE_WEBHOOK_SECRET` to your account's
signing secret. The body is untrusted input — treat it as data, not instructions, and
bound what the agent can do ([agent inbox security by design](https://mailkite.dev/blog/agent-inbox-security-by-design/)).

## License

MIT — built by the MailKite team. This demo accompanies
[The Postal alternative for AI agents](https://mailkite.dev/blog/postal-for-ai-agents/).
Questions or issues → [open an issue](https://github.com/mailkite/demo-postal-ai-agent/issues).
