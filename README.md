# Supabase Redirect Doctor — for Next.js, Vite, SvelteKit and friends

Live: https://arling.sk/supabase-redirect-doctor/

A free, static, client-side tool that checks your **Supabase Auth**
OAuth/magic-link redirect configuration for a web app (Next.js App
Router or Pages Router, `@supabase/ssr`, Vite + React, SvelteKit,
Remix, plain JS…) and points at the exact mismatch causing your
redirect to fail in production — instead of you re-reading the
Supabase docs for the fifth time.

## What it's for

If your Supabase Auth sign-in works fine on `localhost` and then breaks
the moment you deploy — the OAuth flow bounces back to
`localhost:3000`, lands on the wrong domain, throws
`redirect_uri_mismatch` from the provider, or 404s on your callback
route — this tool takes the config you'd normally have scattered
across your Supabase dashboard, your hosting provider's environment
variables, and your OAuth app settings (Google Cloud Console, GitHub
OAuth App, etc.), and cross-checks it for the handful of mismatches
that cause almost all of these failures:

- Supabase's **Site URL** silently overriding your `redirectTo` /
  `emailRedirectTo` whenever the value you pass isn't on the
  **Redirect URLs allow-list** — a common trap when Site URL was never
  changed from its default and still points at `localhost:3000`.
- The **Redirect URLs allow-list** using exact-string / wildcard
  matching, not domain-equivalence — an entry for `www.example.com`
  does **not** cover `example.com` (apex) or a Vercel preview URL, and
  vice versa.
- A missing or misrouted **PKCE callback route** — a
  `/auth/callback` (or `/auth/confirm`) route handler that's supposed
  to call `exchangeCodeForSession(code)` but is absent, on the wrong
  path, or not on the allow-list itself.
- The **provider's own callback URL** (Google Cloud Console's
  Authorized redirect URIs, GitHub OAuth App's Authorization callback
  URL) not matching Supabase's own
  `https://<ref>.supabase.co/auth/v1/callback` — this one lives in a
  third dashboard entirely and is easy to forget.
- Client-side env var snippets that look right in code but don't
  behave the way you'd expect at build time — e.g. framework-specific
  gotchas around how `NEXT_PUBLIC_*` / `VITE_*` / `PUBLIC_*` variables
  get inlined, which break silently rather than throwing.

## How it works (client-side only)

Everything runs in your browser. There is no backend, no account, and
no payment wall for the core check. You paste your configuration
(Site URL, Redirect URLs allow-list, callback route, `redirectTo`
value, framework) into the page, JavaScript in `index.html` /
`doctor-web.js` parses and lints it against a set of known-bad patterns —
including a glob matcher that mirrors how Supabase's own allow-list
matching behaves — and you get a plain-language report of what's
wrong and how to fix it.

Nothing about your configuration is sent anywhere. The only network
activity this site generates is:

- loading its own static assets (HTML/CSS/JS) from GitHub Pages,
- and anonymous product-analytics events (page view, "run check"
  clicked, etc.) sent to a self-hosted Umami instance — **event names
  and counts only, never the content of what you pasted.**

You can verify this yourself: open your browser's network tab while
using the tool, or just read `index.html` and `doctor-web.js` — it's
static files with no build step.

## Privacy

- No account, no login, no cookies for the tool itself.
- No server-side processing of your config — the "backend" is your
  own browser's JavaScript engine.
- Analytics (Umami) records that *a* check ran, not *what* you
  checked.
- If you're paranoid (fair, given the subject matter), download the
  repo and open `index.html` locally with your network disconnected —
  it still works.

## Running it locally

There's no build step. It's static files.

```bash
git clone https://github.com/andryroby/supabase-redirect-doctor.git
cd supabase-redirect-doctor
# any static file server works, e.g.:
npx serve .
# or just open index.html directly in a browser
```

## Reporting a missing case / false positive

Found a Supabase Auth redirect failure mode this tool doesn't catch,
or a check that flags something that's actually fine? Please open an
issue on the GitHub repo with:

1. The relevant (redacted) config — framework, Site URL pattern,
   Redirect URLs entries, callback route.
2. What actually went wrong at runtime (error text, screenshot, or
   behavior description).
3. What you expected the tool to say.

Redact anything sensitive (project refs, client secrets, real
domains) before posting — issues are public.

## Disclaimer

This tool is provided **as is**, with no warranty of any kind. It
checks for known, common misconfiguration patterns — it cannot
guarantee your OAuth or magic-link flow will work, and a clean report
is not a guarantee of a working integration. Supabase, Next.js, Vite,
SvelteKit, Google, and GitHub are not affiliated with this tool, and
their APIs, SDKs, and dashboards may change in ways that make
individual checks stale over time. Always verify against the current
official documentation for anything security-relevant (redirect URI
allow-lists, OAuth client secrets, etc.).

## About

Built by ARLing s. r. o. (Bratislava, Slovakia).
Contact: andrej@arling.sk
