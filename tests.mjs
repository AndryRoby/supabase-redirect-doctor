// tests.mjs — plain Node test runner for doctor-web.js (no external dependencies).
// Run with: node tests.mjs

import { diagnose, expectedValues } from './doctor-web.js';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}${detail ? ' — ' + detail : ''}`);
  }
}

function eq(name, actual, expected) {
  const condition = actual === expected;
  ok(name, condition, condition ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function has(name, arr, code) {
  const condition = Array.isArray(arr) && arr.some((p) => p.code === code);
  ok(name, condition, condition ? '' : `expected a problem with code "${code}", got codes [${(arr || []).map((p) => p.code).join(', ')}]`);
}

function lacks(name, arr, code) {
  const condition = Array.isArray(arr) && !arr.some((p) => p.code === code);
  ok(name, condition, condition ? '' : `did not expect a problem with code "${code}"`);
}

// Access the internal glob matcher the same way diagnose() uses it, via the
// allow-list check inside diagnose(): build a minimal config whose only
// pass/fail signal is whether the callback URL matches the single allow-list
// pattern under test.
function globMatches(pattern, value) {
  const result = diagnose({
    app: { productionOrigin: '', callbackPath: '' },
    code: {},
  });
  // The helper above can't isolate the matcher without a productionOrigin,
  // so instead exercise it directly through a synthetic callback: set
  // productionOrigin+callbackPath so callbackUrl === value, then check the
  // pattern against it.
  const originAndPath = splitUrl(value);
  const r = diagnose({
    app: { productionOrigin: originAndPath.origin, callbackPath: originAndPath.path },
    supabase: { allowedRedirectUrls: [pattern] },
    code: { redirectToSnippet: 'x' },
  });
  return !r.problems.some((p) => p.code === 'callback_not_allowlisted' || p.code === 'allowlist_trailing_slash_mismatch');
}

function splitUrl(value) {
  const m = value.match(/^(https?:\/\/[^/]+)(\/.*)?$/i);
  if (!m) return { origin: value, path: '/' };
  return { origin: m[1], path: m[2] || '/' };
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Glob matcher — Supabase redirect-URL allow-list syntax
//    (https://supabase.com/docs/guides/auth/redirect-urls)
// ─────────────────────────────────────────────────────────────────────────

ok('glob: ** matches a nested path', globMatches('https://myapp.com/**', 'https://myapp.com/auth/callback'));
ok('glob: * matches a single path segment', globMatches('https://myapp.com/*', 'https://myapp.com/callback'));
ok('glob: * does NOT cross a "/" separator', !globMatches('https://myapp.com/*', 'https://myapp.com/callback/sub'));
ok('glob: ** DOES cross a "/" separator', globMatches('https://myapp.com/**', 'https://myapp.com/callback/sub'));
ok('glob: doc example — localhost/** matches nested path', globMatches('http://localhost:3000/**', 'http://localhost:3000/foo/bar'));
ok('glob: doc example — localhost/* matches one segment', globMatches('http://localhost:3000/*', 'http://localhost:3000/foo'));
ok('glob: doc example — localhost/* rejects two segments', !globMatches('http://localhost:3000/*', 'http://localhost:3000/foo/bar'));
ok('glob: Netlify preview pattern from docs', globMatches('https://**--my_org.netlify.app/**', 'https://deploy-preview-1--my_org.netlify.app/foo'));
ok('glob: Vercel preview pattern from docs', globMatches('https://*-team.vercel.app/**', 'https://abc-team.vercel.app/x'));
ok('glob: * does NOT cross a "." separator', !globMatches('https://*-team.vercel.app/**', 'https://abc.def-team.vercel.app/x'));
ok('glob: ? matches exactly one non-separator char', globMatches('https://myapp.com/x?', 'https://myapp.com/xy'));
ok('glob: ? does not match two chars', !globMatches('https://myapp.com/x?', 'https://myapp.com/xyz'));
ok('glob: [abc] character class matches a member', globMatches('https://myapp.com/[abc]', 'https://myapp.com/a'));
ok('glob: [abc] character class rejects a non-member', !globMatches('https://myapp.com/[abc]', 'https://myapp.com/d'));
ok('glob: [!abc] negated class matches a non-member', globMatches('https://myapp.com/[!abc]', 'https://myapp.com/d'));
ok('glob: [!abc] negated class rejects a member', !globMatches('https://myapp.com/[!abc]', 'https://myapp.com/a'));
ok('glob: exact string matches itself', globMatches('https://myapp.com/auth/callback', 'https://myapp.com/auth/callback'));
ok('glob: exact string rejects a superstring', !globMatches('https://myapp.com/auth', 'https://myapp.com/auth2'));

// ─────────────────────────────────────────────────────────────────────────
// 2. Expected values
// ─────────────────────────────────────────────────────────────────────────

{
  const ev = expectedValues({
    app: { productionOrigin: 'https://myapp.com', callbackPath: '/auth/callback', deployedOn: 'vercel' },
    supabase: { projectUrl: 'https://abcd1234.supabase.co' },
  });
  eq('expected: siteUrl = production origin', ev.siteUrl, 'https://myapp.com');
  eq('expected: callbackUrl = origin + path', ev.callbackUrl, 'https://myapp.com/auth/callback');
  eq('expected: supabaseCallback', ev.supabaseCallback, 'https://abcd1234.supabase.co/auth/v1/callback');
  eq('expected: vercel preview pattern', ev.previewPattern, 'https://*.vercel.app/**');
  ok('expected: allowListEntries includes callbackUrl', ev.allowListEntries.includes('https://myapp.com/auth/callback'));
}

{
  const ev = expectedValues({ app: { productionOrigin: 'https://myapp.com', callbackPath: '' } });
  eq('expected: empty callbackPath defaults to /auth/callback', ev.callbackUrl, 'https://myapp.com/auth/callback');
}

{
  const ev = expectedValues({ app: { productionOrigin: 'https://myapp.com/', callbackPath: 'callback' } });
  eq('expected: trailing slash on origin is stripped', ev.siteUrl, 'https://myapp.com');
  eq('expected: bare callback path gets a leading slash', ev.callbackUrl, 'https://myapp.com/callback');
}

{
  const ev = expectedValues({ app: { deployedOn: 'netlify' } });
  eq('expected: netlify preview pattern', ev.previewPattern, 'https://**--<your-site-name>.netlify.app/**');
  eq('expected: no origin -> null siteUrl', ev.siteUrl, null);
  eq('expected: no origin -> null callbackUrl', ev.callbackUrl, null);
}

// ─────────────────────────────────────────────────────────────────────────
// 3. End-to-end scenarios
// ─────────────────────────────────────────────────────────────────────────

const passConfig = {
  app: {
    productionOrigin: 'https://myapp.com',
    callbackPath: '/auth/callback',
    framework: 'nextjs-app',
    usesSsrPackage: true,
    flowType: 'pkce',
    envSiteUrlVar: 'NEXT_PUBLIC_SITE_URL',
    deployedOn: 'vercel',
  },
  supabase: {
    projectUrl: 'https://abcd1234.supabase.co',
    siteUrl: 'https://myapp.com',
    allowedRedirectUrls: ['https://myapp.com/auth/callback', 'https://*.vercel.app/**'],
  },
  provider: {
    name: 'google',
    authorizedRedirectUris: ['https://abcd1234.supabase.co/auth/v1/callback'],
  },
  code: {
    redirectToSnippet: "`${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`",
    callbackRouteExists: true,
    callsExchangeCodeForSession: true,
  },
};

// Scenario 1: pass
{
  const r = diagnose(passConfig);
  eq('scenario pass: status is "pass"', r.status, 'pass');
  ok('scenario pass: no problems reported', r.problems.length === 0, `got ${JSON.stringify(r.problems.map((p) => p.code))}`);
}

// Scenario 2: Site URL is localhost
{
  const cfg = JSON.parse(JSON.stringify(passConfig));
  cfg.supabase.siteUrl = 'http://localhost:3000';
  const r = diagnose(cfg);
  eq('scenario localhost siteUrl: status is "fail"', r.status, 'fail');
  has('scenario localhost siteUrl: reports site_url_is_localhost', r.problems, 'site_url_is_localhost');
  const p = r.problems.find((x) => x.code === 'site_url_is_localhost');
  ok('scenario localhost siteUrl: severity is high', p && p.severity === 'high');
}

// Scenario 3: www vs apex mismatch
{
  const cfg = JSON.parse(JSON.stringify(passConfig));
  cfg.supabase.siteUrl = 'https://www.myapp.com';
  const r = diagnose(cfg);
  eq('scenario www/apex: status is "fail"', r.status, 'fail');
  has('scenario www/apex: reports site_url_www_apex_mismatch', r.problems, 'site_url_www_apex_mismatch');
  lacks('scenario www/apex: does not also report generic site_url_mismatch', r.problems, 'site_url_mismatch');
}

// Scenario 4: missing allow-list entry (callback not covered)
{
  const cfg = JSON.parse(JSON.stringify(passConfig));
  cfg.supabase.allowedRedirectUrls = [];
  const r = diagnose(cfg);
  eq('scenario missing allow-list: status is "fail"', r.status, 'fail');
  has('scenario missing allow-list: reports callback_not_allowlisted', r.problems, 'callback_not_allowlisted');
}

// Scenario 5: provider URI has the app's own origin instead of the Supabase callback
{
  const cfg = JSON.parse(JSON.stringify(passConfig));
  cfg.provider.authorizedRedirectUris = ['https://myapp.com/auth/callback'];
  const r = diagnose(cfg);
  eq('scenario provider URI points to app: status is "fail"', r.status, 'fail');
  has('scenario provider URI points to app: reports provider_uri_points_to_app', r.problems, 'provider_uri_points_to_app');
  lacks('scenario provider URI points to app: does not also report generic provider_redirect_uri_missing', r.problems, 'provider_redirect_uri_missing');
}

// Scenario 5b: provider URI missing entirely (generic case)
{
  const cfg = JSON.parse(JSON.stringify(passConfig));
  cfg.provider.authorizedRedirectUris = ['https://abcd1234.supabase.co/auth/v1/callback/typo'];
  const r = diagnose(cfg);
  eq('scenario bad provider URI: status is "fail"', r.status, 'fail');
  has('scenario bad provider URI: reports provider_redirect_uri_missing', r.problems, 'provider_redirect_uri_missing');
}

// Scenario 6: process?.env optional-chaining bug in redirectTo snippet
{
  const cfg = JSON.parse(JSON.stringify(passConfig));
  cfg.code.redirectToSnippet = "`${process?.env.NEXT_PUBLIC_SITE_URL}/auth/callback`";
  const r = diagnose(cfg);
  eq('scenario process?.env: status is "fail"', r.status, 'fail');
  has('scenario process?.env: reports redirect_snippet_optional_chaining_env', r.problems, 'redirect_snippet_optional_chaining_env');
}

// Scenario 7: implicit flow with SSR framework
{
  const cfg = JSON.parse(JSON.stringify(passConfig));
  cfg.app.flowType = 'implicit';
  cfg.code.callbackRouteExists = null;
  cfg.code.callsExchangeCodeForSession = null;
  const r = diagnose(cfg);
  has('scenario implicit+SSR: reports implicit_flow_with_ssr', r.problems, 'implicit_flow_with_ssr');
  const p = r.problems.find((x) => x.code === 'implicit_flow_with_ssr');
  ok('scenario implicit+SSR: severity is medium', p && p.severity === 'medium');
  eq('scenario implicit+SSR: status is "warn" (medium only)', r.status, 'warn');
}

// Scenario 8: hardcoded localhost in redirectTo snippet
{
  const cfg = JSON.parse(JSON.stringify(passConfig));
  cfg.code.redirectToSnippet = "'http://localhost:3000/auth/callback'";
  const r = diagnose(cfg);
  eq('scenario hardcoded localhost snippet: status is "fail"', r.status, 'fail');
  has('scenario hardcoded localhost snippet: reports redirect_snippet_hardcoded_localhost', r.problems, 'redirect_snippet_hardcoded_localhost');
}

// Scenario 9: missing PKCE callback route
{
  const cfg = JSON.parse(JSON.stringify(passConfig));
  cfg.code.callbackRouteExists = false;
  const r = diagnose(cfg);
  eq('scenario missing callback route: status is "fail"', r.status, 'fail');
  has('scenario missing callback route: reports missing_callback_route', r.problems, 'missing_callback_route');
  const fix = r.fixes.find((f) => f.where.includes('route.ts'));
  ok('scenario missing callback route: fix includes exchangeCodeForSession', fix && fix.value.includes('exchangeCodeForSession'));
}

// Scenario 9b: callback route exists but doesn't exchange the code
{
  const cfg = JSON.parse(JSON.stringify(passConfig));
  cfg.code.callsExchangeCodeForSession = false;
  const r = diagnose(cfg);
  eq('scenario missing exchange call: status is "fail"', r.status, 'fail');
  has('scenario missing exchange call: reports missing_exchange_code_for_session', r.problems, 'missing_exchange_code_for_session');
}

// Scenario 10: trailing-slash mismatch between allow-list and computed callback URL
{
  const cfg = JSON.parse(JSON.stringify(passConfig));
  cfg.supabase.allowedRedirectUrls = ['https://myapp.com/auth/callback/', 'https://*.vercel.app/**'];
  const r = diagnose(cfg);
  eq('scenario trailing slash mismatch: status is "warn"', r.status, 'warn');
  has('scenario trailing slash mismatch: reports allowlist_trailing_slash_mismatch', r.problems, 'allowlist_trailing_slash_mismatch');
  lacks('scenario trailing slash mismatch: does not also report callback_not_allowlisted', r.problems, 'callback_not_allowlisted');
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Extra tolerance / edge-case checks
// ─────────────────────────────────────────────────────────────────────────

// Tolerant of a fully empty config — should not throw, should fail loudly
// (missing site URL etc.) rather than silently passing.
{
  const r = diagnose({});
  ok('empty config: does not throw and returns a status', ['pass', 'warn', 'fail'].includes(r.status));
  has('empty config: reports missing_production_origin', r.problems, 'missing_production_origin');
  has('empty config: reports missing_site_url', r.problems, 'missing_site_url');
}

// http (not https) Site URL is flagged regardless of productionOrigin match.
{
  const cfg = JSON.parse(JSON.stringify(passConfig));
  cfg.supabase.siteUrl = 'http://myapp.com';
  const r = diagnose(cfg);
  has('http site url: reports site_url_not_https', r.problems, 'site_url_not_https');
  const p = r.problems.find((x) => x.code === 'site_url_not_https');
  ok('http site url: severity is high', p && p.severity === 'high');
}

// Site URL with a trailing slash is flagged as low, and still status warn only.
{
  const cfg = JSON.parse(JSON.stringify(passConfig));
  cfg.supabase.siteUrl = 'https://myapp.com/';
  const r = diagnose(cfg);
  has('site url trailing slash: reports site_url_trailing_slash', r.problems, 'site_url_trailing_slash');
  const p = r.problems.find((x) => x.code === 'site_url_trailing_slash');
  ok('site url trailing slash: severity is low', p && p.severity === 'low');
}

// window.location.origin with no SSR fallback, on an SSR framework.
{
  const cfg = JSON.parse(JSON.stringify(passConfig));
  cfg.code.redirectToSnippet = "`${window.location.origin}/auth/callback`";
  const r = diagnose(cfg);
  has('origin no fallback: reports redirect_snippet_origin_no_ssr_fallback', r.problems, 'redirect_snippet_origin_no_ssr_fallback');
  const p = r.problems.find((x) => x.code === 'redirect_snippet_origin_no_ssr_fallback');
  ok('origin no fallback: severity is low', p && p.severity === 'low');
}

// window.location.origin WITH a guard should not trigger the low-severity check.
{
  const cfg = JSON.parse(JSON.stringify(passConfig));
  cfg.code.redirectToSnippet = "typeof window !== 'undefined' ? window.location.origin + '/auth/callback' : process.env.NEXT_PUBLIC_SITE_URL";
  const r = diagnose(cfg);
  lacks('origin with guard: no redirect_snippet_origin_no_ssr_fallback', r.problems, 'redirect_snippet_origin_no_ssr_fallback');
}

// Missing redirectTo snippet entirely.
{
  const cfg = JSON.parse(JSON.stringify(passConfig));
  cfg.code.redirectToSnippet = '';
  const r = diagnose(cfg);
  has('empty snippet: reports redirect_snippet_missing', r.problems, 'redirect_snippet_missing');
  const p = r.problems.find((x) => x.code === 'redirect_snippet_missing');
  ok('empty snippet: severity is medium', p && p.severity === 'medium');
}

// project URL that isn't a standard supabase.co domain.
{
  const cfg = JSON.parse(JSON.stringify(passConfig));
  cfg.supabase.projectUrl = 'not-a-url';
  const r = diagnose(cfg);
  has('unusual project url: reports project_url_unusual', r.problems, 'project_url_unusual');
}

// missing project URL entirely.
{
  const cfg = JSON.parse(JSON.stringify(passConfig));
  cfg.supabase.projectUrl = '';
  const r = diagnose(cfg);
  has('missing project url: reports missing_project_url', r.problems, 'missing_project_url');
  const p = r.problems.find((x) => x.code === 'missing_project_url');
  ok('missing project url: severity is low', p && p.severity === 'low');
}

// flowType not set on an SSR framework nudges toward PKCE (low).
{
  const cfg = JSON.parse(JSON.stringify(passConfig));
  cfg.app.flowType = '';
  const r = diagnose(cfg);
  has('flowType unset on SSR: reports flow_type_not_set', r.problems, 'flow_type_not_set');
}

// flowType not set on a plain Vite app (no SSR) should NOT nudge toward PKCE.
{
  const cfg = JSON.parse(JSON.stringify(passConfig));
  cfg.app.flowType = '';
  cfg.app.framework = 'vite';
  cfg.app.usesSsrPackage = false;
  cfg.code.callbackRouteExists = null;
  cfg.code.callsExchangeCodeForSession = null;
  const r = diagnose(cfg);
  lacks('flowType unset on Vite (no SSR): no flow_type_not_set', r.problems, 'flow_type_not_set');
}

// Vercel deploy with no vercel.app pattern on the allow-list.
{
  const cfg = JSON.parse(JSON.stringify(passConfig));
  cfg.supabase.allowedRedirectUrls = ['https://myapp.com/auth/callback'];
  const r = diagnose(cfg);
  has('vercel no preview pattern: reports vercel_preview_not_allowlisted', r.problems, 'vercel_preview_not_allowlisted');
  const p = r.problems.find((x) => x.code === 'vercel_preview_not_allowlisted');
  ok('vercel no preview pattern: severity is low', p && p.severity === 'low');
}

// Netlify deploy with no netlify.app pattern on the allow-list.
{
  const cfg = JSON.parse(JSON.stringify(passConfig));
  cfg.app.deployedOn = 'netlify';
  cfg.supabase.allowedRedirectUrls = ['https://myapp.com/auth/callback'];
  const r = diagnose(cfg);
  has('netlify no preview pattern: reports netlify_preview_not_allowlisted', r.problems, 'netlify_preview_not_allowlisted');
}

// Cloudflare deploy: no vercel/netlify-specific nudge should fire.
{
  const cfg = JSON.parse(JSON.stringify(passConfig));
  cfg.app.deployedOn = 'cloudflare';
  const r = diagnose(cfg);
  lacks('cloudflare: no vercel_preview_not_allowlisted', r.problems, 'vercel_preview_not_allowlisted');
  lacks('cloudflare: no netlify_preview_not_allowlisted', r.problems, 'netlify_preview_not_allowlisted');
}

// A generic (non-www) Site URL host mismatch is its own code, not the www/apex one.
{
  const cfg = JSON.parse(JSON.stringify(passConfig));
  cfg.supabase.siteUrl = 'https://totally-different.com';
  const r = diagnose(cfg);
  has('generic host mismatch: reports site_url_mismatch', r.problems, 'site_url_mismatch');
  lacks('generic host mismatch: does not report site_url_www_apex_mismatch', r.problems, 'site_url_www_apex_mismatch');
}

// Azure and Discord provider labels resolve (no crash, sensible field name).
{
  const cfg = JSON.parse(JSON.stringify(passConfig));
  cfg.provider.name = 'azure';
  cfg.provider.authorizedRedirectUris = [];
  const r = diagnose(cfg);
  const p = r.problems.find((x) => x.code === 'provider_redirect_uri_missing');
  ok('azure provider: message references Azure Portal', p && p.message.includes('Azure Portal'));
}
{
  const cfg = JSON.parse(JSON.stringify(passConfig));
  cfg.provider.name = 'discord';
  cfg.provider.authorizedRedirectUris = [];
  const r = diagnose(cfg);
  const p = r.problems.find((x) => x.code === 'provider_redirect_uri_missing');
  ok('discord provider: message references Discord Developer Portal', p && p.message.includes('Discord Developer Portal'));
}

// checklist is always populated and never throws on a minimal config.
{
  const r = diagnose({ app: { productionOrigin: 'https://a.com' } });
  ok('minimal config: checklist has entries', r.checklist.length >= 3);
  ok('minimal config: disclaimer present', typeof r.disclaimer === 'string' && r.disclaimer.length > 10);
}

// ─────────────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log('All tests passed.');
}
