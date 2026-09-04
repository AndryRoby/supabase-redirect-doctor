# Supabase Redirect Doctor

Checks a Supabase Auth OAuth or magic-link redirect configuration for a web app (Next.js, Vite, SvelteKit, or similar) and finds why it works on localhost and breaks in production.

Live: https://arling.sk/supabase-redirect-doctor/

## What it checks

You paste your Supabase and app configuration into the page. The checks, in the order the engine runs them:

- **Production origin present.** Without `app.productionOrigin` the tool can't compute or verify the exact callback URL.
- **Supabase Site URL.** Empty, still pointing at `localhost`, missing `https`, a trailing slash, or not matching your production origin (including a `www` vs. apex mismatch). Supabase falls back to Site URL whenever `redirectTo` is missing or not allow-listed, so a wrong Site URL sends users to the wrong place silently.
- **Supabase project URL shape.** Flags a `projectUrl` that doesn't look like `https://<ref>.supabase.co`.
- **Redirect URLs allow-list coverage.** Whether the app's exact callback URL is covered by an allow-list entry, including a trailing-slash-only mismatch, and whether a Vercel or Netlify deployment has its preview-domain wildcard allow-listed.
- **Provider console callback URL.** Whether Google Cloud Console, GitHub OAuth App, Apple, Azure, or Discord has the exact `https://<ref>.supabase.co/auth/v1/callback`, and catches the common mistake of putting the app's own domain there instead.
- **PKCE callback route.** Whether a callback route exists and calls `exchangeCodeForSession(code)`, and whether `flowType: "implicit"` was left set on an SSR (`@supabase/ssr`, Next.js) setup that needs PKCE instead.
- **`redirectTo` code snippet.** Hardcoded `http://localhost`, the `process?.env.VAR` optional-chaining bug that silently evaluates to `undefined` at build time, and `window.location.origin` used without an SSR-safe fallback.

## What it does not do

This is a config linter, not a live tester. It does not call Supabase, the OAuth provider, or your app. It does not sign in, exchange a code, or verify that your project actually exists. It only checks the values you type against known-bad patterns and reports the mismatch. Nothing you paste is sent anywhere, and it does not create an account or ask for one.

## How it works

Everything runs in one pure function, `diagnose(config)`, exported from `doctor-web.js` and also exposed as `window.RedirectDoctorWeb.diagnose` when the page loads it as a module. It takes no network calls; it only reads the object you pass in.

```json
{
  "app": { "productionOrigin": "https://myapp.com", "callbackPath": "/auth/callback", "flowType": "pkce" },
  "supabase": {
    "projectUrl": "https://abcd1234.supabase.co",
    "siteUrl": "http://localhost:3000",
    "allowedRedirectUrls": ["https://myapp.com/auth/callback"]
  },
  "provider": { "name": "google", "authorizedRedirectUris": ["https://abcd1234.supabase.co/auth/v1/callback"] }
}
```

```json
{
  "status": "fail",
  "summary": "1 blocking mismatch found. Most urgent: Supabase Site URL still points to localhost. Supabase falls back to Site URL whenever redirectTo is missing or not allow-listed, so a rejected redirect silently sends users to localhost: including in production.",
  "problems": [
    { "severity": "high", "code": "site_url_is_localhost", "message": "Supabase Site URL still points to localhost. Supabase falls back to Site URL whenever redirectTo is missing or not allow-listed, so a rejected redirect silently sends users to localhost: including in production." },
    { "severity": "medium", "code": "redirect_snippet_missing", "message": "No redirectTo snippet was provided. Without an explicit redirectTo, signInWithOAuth() falls back to Site URL: which only works if Site URL is exactly your production origin." }
  ]
}
```

That is the real, unedited output of running `node` and calling `diagnose(input)` on this repo's `doctor-web.js` (the em dashes above are the engine's own message text, quoted verbatim). The site URL is a leftover default, so the redirect will bounce to `localhost:3000` in production even though the allow-list entry and provider callback are both correct.

## Run locally

No build step, no dependencies.

```bash
git clone https://github.com/AndryRoby/supabase-redirect-doctor.git
cd supabase-redirect-doctor
python -m http.server
# or just open index.html directly in a browser
```

## Tests

```bash
node tests.mjs
```

87 assertions, 0 failures, against `doctor-web.js` directly (no browser needed).

## Privacy

Everything runs client-side; nothing you paste into the form is sent anywhere. Umami analytics is self-hosted and cookie-free, and records only that a check ran, never the content of it. Joining the email list on the page is optional and only for new-tool announcements. Details: https://arling.sk/privacy/

## Sources

The rules implemented here come from:

- [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls): Site URL fallback behavior, redirect allow-list glob syntax, documented Vercel/Netlify preview patterns
- [Server-Side Auth for Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs): `@supabase/ssr`, cookie-based SSR sessions
- [Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google): provider callback URL format, PKCE code-exchange step
- [supabase/discussions#38063](https://github.com/orgs/supabase/discussions/38063): the `process?.env` optional-chaining bug that silently resolves to `undefined` in the browser bundle

## Report a problem

Found a redirect failure this tool doesn't catch, or a check that flags something that's actually fine? Open an issue: https://github.com/AndryRoby/supabase-redirect-doctor/issues, or write to andrej@arling.sk. Redact real domains, project refs, or client secrets first, issues are public.

## License

All rights reserved, see [LICENSE-NOTICE.md](LICENSE-NOTICE.md). Reading the code and learning from it is fine; deploying a copy of it as your own product is not.

---

ARLing s. r. o., Bratislava. Hub: https://arling.sk/

Sister tools:
- https://arling.sk/google-oauth-redirect-doctor/
- https://arling.sk/expo-supabase-auth-doctor/
- https://arling.sk/supabase-redirect-doctor/ (this one)
- https://arling.sk/flutter-supabase-doctor/
- https://arling.sk/expo-universal-links-doctor/
- https://arling.sk/sepa-pain001-doctor/
- https://arling.sk/bookapp/
