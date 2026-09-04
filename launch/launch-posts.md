# Launch posts — Supabase Redirect Doctor

Tool: https://arling.sk/supabase-redirect-doctor/
All copy below is ready to paste. Read each platform's current rules
immediately before posting (noted per-section) — rules and mod
sentiment change over time and this file won't stay current with them.
GitHub replies quote specifics from each thread (framework, error
text, who said what) — don't reuse a paragraph verbatim across
threads, each is tailored below.

---

## 1. GitHub thread replies

Post these as regular replies on the existing threads/issues. Keep
them factual and specific to what each thread actually reported.

### 1a. `orgs/supabase` discussion #26483 — "Always redirects to localhost despite correct redirect URLs"
Next.js App Router. Magic link email shows the right production
domain, but visiting `/auth/confirm` still redirects to
`https://localhost:3000`; Google OAuth lands on
`/error?code=...`. Unanswered.

> This exact combo — the magic-link email shows the right domain but
> `/auth/confirm` still bounces to localhost, and Google OAuth lands
> on `/error?code=...` — is almost always the Redirect URLs allow-list,
> not the Site URL field by itself. Supabase checks your
> `emailRedirectTo` / `redirectTo` value against the allow-list with an
> exact-match/wildcard rule; if it doesn't match byte-for-byte
> (trailing slash, http vs https, or the `/auth/confirm` path itself
> not being its own entry), it silently falls back to Site URL — and
> if that's still the default `localhost:3000`, that explains both
> symptoms at once. Worth checking that the full callback path is a
> separate allow-list entry (not just the origin), and that your
> route handler actually calls `exchangeCodeForSession(code)` rather
> than just reading `?code=` off the URL.
>
> I built a free client-side checker for this class of bug — paste
> your Site URL, allow-list, and callback route and it flags which
> piece doesn't match: https://arling.sk/supabase-redirect-doctor/

### 1b. `supabase/supabase` issue #41700 — "Google OAuth redirects to localhost instead of configured Site URL"
Next.js. Apex domain (no `www`) redirects to localhost; the same
domain *with* `www` works; random test URLs also work. Closed as
"awaiting-details" / "external-issue", no maintainer diagnosis in
thread.

> The www-vs-apex split here is a real signal, not a coincidence.
> Supabase's Redirect URLs allow-list does exact-string / wildcard
> matching — it has no notion that `example.com` and
> `www.example.com` are "the same" domain. If the allow-list (or Site
> URL) only has the `www` entry, any request whose `redirectTo`
> resolves to the apex origin simply won't match, and Supabase falls
> back to Site URL — which is exactly the "localhost on apex only"
> symptom described here. Fix is either adding both apex and `www` as
> separate allow-list entries, or picking one canonical host and
> redirecting the other to it at the DNS/hosting layer so Supabase
> only ever sees one origin.
>
> I built a free client-side checker that flags this apex/www
> allow-list mismatch (and the Site-URL-fallback pattern generally) —
> paste your Site URL and allow-list entries:
> https://arling.sk/supabase-redirect-doctor/

### 1c. `orgs/supabase` discussion #38063 — "Supabase Google Oauth redirect to localhost:3000"
Next.js on a VPS (Coolify). `NEXT_PUBLIC_SITE_URL` set correctly;
@ronny-schlidt identified that `process?.env?.NEXT_PUBLIC_SITE_URL`
(optional chaining) broke client-side while the direct
`process.env.NEXT_PUBLIC_SITE_URL` form worked. Marked answered.

> The optional-chaining detail @ronny-schlidt found is worth calling
> out on its own, since it'll bite other people silently: Next.js
> inlines `process.env.NEXT_PUBLIC_*` via static analysis at build
> time — it looks for that literal member-expression pattern in your
> source and swaps in the real string. `process?.env?.NEXT_PUBLIC_SITE_URL`
> (or any dynamic/bracket access) doesn't match that pattern, so the
> bundler can't inline it, and in the browser bundle it just evaluates
> to `undefined` instead of throwing — which only shows up once
> something client-side stops matching what ran fine server-side or
> in dev.
>
> I built a free client-side tool that flags this class of Supabase
> redirect misconfiguration (Site URL fallback, allow-list mismatches,
> callback route issues) before it costs an afternoon:
> https://arling.sk/supabase-redirect-doctor/

### 1d. `orgs/supabase` discussion #12942 — "`signInWithOAuth` always redirects to `localhost:3000` in production"
Next.js 13, `@supabase/auth-helpers-nextjs` v2.8.0, deployed to
Vercel. GitHub provider, `redirectTo` set explicitly in code but
still fell back to localhost. Answered by a Supabase collaborator:
URLs weren't set in the dashboard.

> Matches what was already flagged in the answer — the `redirectTo`
> you pass in code is only ever a *request*; Supabase still checks it
> against the Redirect URLs allow-list in the dashboard, and if it's
> not there (or only the bare origin is listed, not the full path), it
> discards it and falls back to Site URL. That's why setting
> `redirectTo` correctly in `signInWithOAuth()` alone doesn't fix it,
> no matter how right the URL looks in your code. Worth adding for
> anyone finding this now: if you deploy preview branches too, those
> need their own wildcard allow-list entry (e.g. `https://*.vercel.app/**`)
> or they'll hit the exact same fallback.
>
> I built a free client-side checker for exactly this failure mode —
> paste your Site URL, allow-list, and `redirectTo` and it flags the
> mismatch directly: https://arling.sk/supabase-redirect-doctor/

### 1e. `orgs/supabase` discussion #25756 — "Google oauth redirects to localhost on production"
Next.js on Vercel (`dailyclimab.vercel.app`). `redirectTo` built from
`location.origin` in code, still redirected to `localhost:3000?code=xyz`
in production. OP self-answered: updating Site URL + adding the
production domain to the allow-list fixed it.

> Glad you got there — worth adding for anyone else landing here from
> search: updating Site URL alone isn't always enough, because
> Supabase checks `redirectTo` against the separate Redirect URLs
> allow-list too, and it's an exact-match/wildcard check, not "same
> domain counts." So `https://dailyclimab.vercel.app/auth/callback`
> needs to be its own allow-list entry, not just the bare origin — and
> if you ever deploy preview branches, you'll want a wildcard entry as
> well, since each preview gets a different `*.vercel.app` subdomain
> that won't match one hardcoded URL.
>
> I built a free client-side checker for this exact pattern (Site URL
> vs. allow-list vs. callback route mismatches), since it trips up so
> many Next.js + Vercel + Supabase setups:
> https://arling.sk/supabase-redirect-doctor/

---

## 2. Show HN

**Read HN's guidelines immediately before posting**
(https://news.ycombinator.com/newsguidelines.html and the Show HN
specific notes at https://news.ycombinator.com/showhn.html) — in
particular, post from the account that will actually respond in
comments, and be ready to answer questions for a few hours after
posting.

**Title:**
```
Show HN: Supabase Redirect Doctor – find why your OAuth redirect breaks in production
```

**Text:**
```
I kept seeing (and hitting) the same handful of Supabase Auth redirect
failures on web apps — Google/GitHub sign-in that works fine on
localhost and then bounces back to localhost, or a blank error page,
the moment you deploy. The cause is almost always one of: Site URL
silently overriding your redirectTo because the value isn't on the
Redirect URLs allow-list, the allow-list treating apex and www as
different origins (or missing a wildcard for preview deploys), a PKCE
callback route that's missing or not itself allow-listed, or a client
env var that reads fine in your editor but doesn't get inlined the
way you'd expect at build time (Next.js's NEXT_PUBLIC_* handling has
a specific gotcha here). None of it is hard once you know where to
look, but the error messages don't say where that is.

Supabase Redirect Doctor is a free, static, client-side page: paste
your Site URL, Redirect URLs allow-list, callback route, and
redirectTo value (Next.js, Vite, SvelteKit, whatever you're on), and
it lints it against these known-bad patterns and tells you exactly
which value doesn't match which. It's not a live tester — it doesn't
call Supabase or your OAuth provider, so it won't catch a bug in your
callback route's exchange logic, only the config mismatches. No
account, no server, nothing you paste leaves your browser except
anonymous "a check ran" analytics events. Feedback and missing cases
very welcome.
```
