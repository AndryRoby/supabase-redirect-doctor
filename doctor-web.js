// doctor-web.js — Supabase Auth Redirect Doctor (web apps) core logic.
//
// Pure, deterministic, 100% client-side: given a web app + Supabase Auth OAuth
// redirect configuration (Next.js App/Pages Router, Vite/React, SvelteKit, …),
// works out the exact Site URL / callback URL / provider redirect URI your
// setup needs, checks it against the Supabase redirect allow-list and the
// OAuth provider console, and reports concrete mismatches + copy-paste fixes.
//
// Nothing in this file makes a network request. It only reads the object you
// pass to diagnose().
//
// This is the sibling of the Expo + Supabase tool's doctor.js — same glob
// matcher (copied verbatim, not imported, so this file has zero cross-repo
// dependencies), same diagnose() shape, different domain rules for web apps
// instead of native/Expo runtimes.
//
// Rules implemented here are sourced from:
//  - https://supabase.com/docs/guides/auth/redirect-urls
//      (Site URL fallback behaviour: "the Site URL... defines the default
//      redirect URL when no redirectTo is specified"; glob syntax for the
//      redirect allow-list — "." and "/" are separator characters; the
//      documented Vercel pattern "https://*-<team-or-account-slug>.vercel.app/**"
//      with NEXT_PUBLIC_VERCEL_URL, and Netlify pattern
//      "https://**--my_org.netlify.app/**")
//  - https://supabase.com/docs/guides/auth/server-side/nextjs
//      (@supabase/ssr for cookie-based SSR sessions via createServerClient /
//      createBrowserClient)
//  - https://supabase.com/docs/guides/auth/social-login/auth-google
//      (provider callback URL format https://<project-ref>.supabase.co/auth/v1/callback;
//      PKCE flow needs an explicit code-exchange step via exchangeCodeForSession()
//      in a callback route, distinct from the implicit flow)
//  - https://github.com/orgs/supabase/discussions/38063
//      (real-world report of `process?.env.NEXT_PUBLIC_SITE_URL` silently
//      resolving to undefined in the browser bundle because optional chaining
//      on `process` short-circuits where `process` isn't defined client-side)
//
// Works as an ES module (import { diagnose, expectedValues } from './doctor-web.js')
// and, when loaded with <script type="module">, also publishes
// window.RedirectDoctorWeb = { diagnose, expectedValues } for console/debug use.

// ───────────────────────── small string helpers ─────────────────────────

function safeStr(v) {
  return typeof v === 'string' ? v : '';
}

function trimTrailingSlash(s) {
  return safeStr(s).trim().replace(/\/+$/, '');
}

function normalizeCallbackPath(rawPath) {
  const input = safeStr(rawPath).trim();
  const fallback = '/auth/callback';
  if (!input) return fallback;
  let p = input.replace(/\/{2,}/g, '/');
  if (!p.startsWith('/')) p = '/' + p;
  p = p.replace(/\/+$/, '');
  return p || '/';
}

function hostnameOf(url) {
  const m = safeStr(url).trim().match(/^https?:\/\/([^/?#]+)/i);
  return m ? m[1].toLowerCase() : '';
}

function schemeOf(url) {
  const m = safeStr(url).trim().match(/^(https?):\/\//i);
  return m ? m[1].toLowerCase() : '';
}

function stripWww(host) {
  return host.replace(/^www\./i, '');
}

// ───────────────────────── Supabase redirect-URL glob matcher ─────────────────────────
// Copied verbatim from the Expo + Supabase Redirect Doctor's doctor.js — the
// allow-list syntax is a Supabase Auth feature, identical for every client.
// Per https://supabase.com/docs/guides/auth/redirect-urls — "." and "/" are
// separator characters:
//   *   any run of non-separator characters
//   **  any run of characters, including separators
//   ?   exactly one non-separator character
//   [abc] / [!abc]   one character in / not in the class
//   \c  escapes the next character literally

function escapeRegexChar(c) {
  return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function globToRegExp(pattern) {
  const src = safeStr(pattern);
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length) {
      out += escapeRegexChar(src[++i]);
    } else if (c === '*') {
      if (src[i + 1] === '*') {
        out += '[\\s\\S]*';
        i++;
      } else {
        out += '[^./]*';
      }
    } else if (c === '?') {
      out += '[^./]';
    } else if (c === '[') {
      let j = i + 1;
      let neg = false;
      if (src[j] === '!') {
        neg = true;
        j++;
      }
      let cls = '';
      while (j < src.length && src[j] !== ']') {
        cls += src[j];
        j++;
      }
      out += '[' + (neg ? '^' : '') + cls.replace(/\\/g, '\\\\') + ']';
      i = j;
    } else {
      out += escapeRegexChar(c);
    }
  }
  return new RegExp('^' + out + '$');
}

function globMatch(pattern, value) {
  if (!pattern || !value) return false;
  try {
    return globToRegExp(pattern).test(value);
  } catch (e) {
    return false;
  }
}

function matchesAnyAllowlist(value, patterns) {
  if (!value) return false;
  const list = Array.isArray(patterns) ? patterns : [];
  return list.some((p) => typeof p === 'string' && p.trim() && globMatch(p.trim(), value));
}

// ───────────────────────── expected-value builders ─────────────────────────

function previewPatternFor(deployedOn) {
  if (deployedOn === 'vercel') return 'https://*.vercel.app/**';
  if (deployedOn === 'netlify') return 'https://**--<your-site-name>.netlify.app/**';
  return null;
}

function buildSupabaseCallback(projectUrl) {
  const base = trimTrailingSlash(projectUrl);
  return base ? `${base}/auth/v1/callback` : null;
}

function computeExpected(cfg) {
  const app = cfg.app && typeof cfg.app === 'object' ? cfg.app : {};
  const supabase = cfg.supabase && typeof cfg.supabase === 'object' ? cfg.supabase : {};

  const productionOrigin = trimTrailingSlash(app.productionOrigin);
  const callbackPath = normalizeCallbackPath(app.callbackPath);
  const callbackUrl = productionOrigin ? `${productionOrigin}${callbackPath}` : null;
  const supabaseCallback = buildSupabaseCallback(supabase.projectUrl);
  const previewPattern = previewPatternFor(safeStr(app.deployedOn));

  const allowListEntries = [];
  if (callbackUrl) allowListEntries.push(callbackUrl);
  if (productionOrigin) allowListEntries.push(`${productionOrigin}/**`);
  if (previewPattern) allowListEntries.push(previewPattern);

  return {
    siteUrl: productionOrigin || null,
    callbackUrl,
    allowListEntries,
    supabaseCallback,
    previewPattern,
  };
}

// ───────────────────────── diagnose() ─────────────────────────

const PROVIDER_FIELD_LABEL = {
  google: '"Authorized redirect URIs" in Google Cloud Console → APIs & Services → Credentials',
  github: '"Authorization callback URL" in the GitHub OAuth App settings',
  apple: '"Return URLs" on the Services ID in Apple Developer → Certificates, Identifiers & Profiles',
  azure: '"Redirect URI" in Azure Portal → App registrations → Authentication',
  discord: '"Redirects" in the Discord Developer Portal → OAuth2',
  other: "the redirect/callback URL field in your provider's console",
};

function providerLabel(name) {
  return PROVIDER_FIELD_LABEL[name] || PROVIDER_FIELD_LABEL.other;
}

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

function sortProblems(problems) {
  return problems
    .map((p, idx) => ({ p, idx }))
    .sort((a, b) => (SEVERITY_ORDER[a.p.severity] - SEVERITY_ORDER[b.p.severity]) || (a.idx - b.idx))
    .map((x) => x.p);
}

function callbackRouteSnippet(callbackPath) {
  const routeDir = callbackPath.replace(/^\//, ''); // e.g. "auth/callback"
  return {
    where: `app/${routeDir}/route.ts`,
    code:
      `import { NextResponse } from 'next/server'\n` +
      `import { createClient } from '@/utils/supabase/server'\n\n` +
      `export async function GET(request: Request) {\n` +
      `  const { searchParams, origin } = new URL(request.url)\n` +
      `  const code = searchParams.get('code')\n` +
      `  const next = searchParams.get('next') ?? '/'\n\n` +
      `  if (code) {\n` +
      `    const supabase = await createClient()\n` +
      `    const { error } = await supabase.auth.exchangeCodeForSession(code)\n` +
      `    if (!error) {\n` +
      `      const forwardedHost = request.headers.get('x-forwarded-host')\n` +
      `      const isLocalEnv = process.env.NODE_ENV === 'development'\n` +
      `      if (isLocalEnv) {\n` +
      `        return NextResponse.redirect(\`\${origin}\${next}\`)\n` +
      `      } else if (forwardedHost) {\n` +
      `        return NextResponse.redirect(\`https://\${forwardedHost}\${next}\`)\n` +
      `      } else {\n` +
      `        return NextResponse.redirect(\`\${origin}\${next}\`)\n` +
      `      }\n` +
      `    }\n` +
      `  }\n\n` +
      `  return NextResponse.redirect(\`\${origin}/auth/auth-code-error\`)\n` +
      `}`,
  };
}

/**
 * @param {object} config
 * @param {{productionOrigin?:string, callbackPath?:string, framework?:'nextjs-app'|'nextjs-pages'|'vite'|'sveltekit'|'other', usesSsrPackage?:boolean|null, flowType?:'pkce'|'implicit'|'', envSiteUrlVar?:string, deployedOn?:'vercel'|'netlify'|'cloudflare'|'other'}} [config.app]
 * @param {{projectUrl?:string, siteUrl?:string, allowedRedirectUrls?:string[]}} [config.supabase]
 * @param {{name?:'google'|'github'|'apple'|'azure'|'discord'|'other', authorizedRedirectUris?:string[]}} [config.provider]
 * @param {{redirectToSnippet?:string, callbackRouteExists?:boolean|null, callsExchangeCodeForSession?:boolean|null}} [config.code]
 * @returns {{status:'pass'|'warn'|'fail', summary:string, expected:object, problems:Array, fixes:Array, checklist:string[], disclaimer:string}}
 */
export function diagnose(config) {
  const cfg = config && typeof config === 'object' ? config : {};
  const app = cfg.app && typeof cfg.app === 'object' ? cfg.app : {};
  const supabase = cfg.supabase && typeof cfg.supabase === 'object' ? cfg.supabase : {};
  const provider = cfg.provider && typeof cfg.provider === 'object' ? cfg.provider : {};
  const code = cfg.code && typeof cfg.code === 'object' ? cfg.code : {};

  const problems = [];
  const fixes = [];
  const checklist = [];

  const expected = computeExpected(cfg);
  const { callbackUrl, supabaseCallback } = expected;

  const productionOrigin = trimTrailingSlash(app.productionOrigin);
  const callbackPath = normalizeCallbackPath(app.callbackPath);
  const framework = safeStr(app.framework).trim();
  const deployedOn = safeStr(app.deployedOn).trim();
  const flowType = safeStr(app.flowType).trim().toLowerCase();
  const envSiteUrlVar = safeStr(app.envSiteUrlVar).trim();

  const frameworkIsNextjs = framework === 'nextjs-app' || framework === 'nextjs-pages';
  const ssrExpected = app.usesSsrPackage === true || frameworkIsNextjs;

  // ── 1. production origin present? ───────────────────────────────────
  if (!productionOrigin) {
    problems.push({
      severity: 'medium',
      code: 'missing_production_origin',
      message: 'app.productionOrigin is empty, so the exact callback URL and Site URL can\'t be computed or checked against your allow-list.',
      where: 'app.productionOrigin',
    });
  }

  // ── 2. Supabase Site URL ─────────────────────────────────────────────
  const rawSiteUrl = safeStr(supabase.siteUrl).trim();
  const siteUrl = trimTrailingSlash(rawSiteUrl);
  const siteUrlHadTrailingSlash = !!rawSiteUrl && rawSiteUrl !== siteUrl;
  const siteUrlIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(siteUrl);

  if (!siteUrl) {
    problems.push({
      severity: 'medium',
      code: 'missing_site_url',
      message: "supabase.siteUrl is empty. Supabase's own default after project creation is often still http://localhost:3000 — that default silently ships to production until someone changes it.",
      where: 'supabase.siteUrl',
    });
    fixes.push({
      title: 'Set Site URL',
      value: productionOrigin || 'https://your-production-domain.com',
      where: 'Supabase → Authentication → URL Configuration → Site URL',
    });
  } else if (siteUrlIsLocal) {
    problems.push({
      severity: 'high',
      code: 'site_url_is_localhost',
      message: 'Supabase Site URL still points to localhost. Supabase falls back to Site URL whenever redirectTo is missing or not allow-listed, so a rejected redirect silently sends users to localhost — including in production.',
      where: 'supabase.siteUrl',
    });
    fixes.push({
      title: 'Set Site URL to your production URL',
      value: productionOrigin || 'https://your-production-domain.com',
      where: 'Supabase → Authentication → URL Configuration → Site URL',
    });
  } else {
    if (siteUrlHadTrailingSlash) {
      problems.push({
        severity: 'low',
        code: 'site_url_trailing_slash',
        message: `Site URL "${rawSiteUrl}" has a trailing slash. Supabase's URL Configuration expects it without one — keep it exact to avoid subtle mismatches.`,
        where: 'supabase.siteUrl',
      });
      fixes.push({ title: 'Remove the trailing slash from Site URL', value: siteUrl, where: 'Supabase → Authentication → URL Configuration → Site URL' });
    }
    if (/^http:\/\//i.test(siteUrl)) {
      problems.push({
        severity: 'high',
        code: 'site_url_not_https',
        message: 'Site URL uses http instead of https. Use https in production — most OAuth providers reject or warn on plain-http redirect targets, and browsers increasingly block mixed content.',
        where: 'supabase.siteUrl',
      });
      fixes.push({ title: 'Use https for Site URL', value: siteUrl.replace(/^http:\/\//i, 'https://'), where: 'Supabase → Authentication → URL Configuration → Site URL' });
    } else if (productionOrigin) {
      const siteHost = hostnameOf(siteUrl);
      const prodHost = hostnameOf(productionOrigin);
      if (siteHost && prodHost && siteHost !== prodHost) {
        if (stripWww(siteHost) === stripWww(prodHost)) {
          problems.push({
            severity: 'high',
            code: 'site_url_www_apex_mismatch',
            message: `Site URL is "${siteUrl}" but your production origin is "${productionOrigin}" — a www vs. apex mismatch. Pick one as canonical: it must be the Site URL, and the other domain (if you still serve it) needs its own allow-list entry or a redirect to the canonical one.`,
            where: 'supabase.siteUrl',
          });
          fixes.push({ title: 'Make Site URL match your canonical production origin exactly', value: productionOrigin, where: 'Supabase → Authentication → URL Configuration → Site URL' });
        } else {
          problems.push({
            severity: 'high',
            code: 'site_url_mismatch',
            message: `Site URL is "${siteUrl}" but app.productionOrigin is "${productionOrigin}". Supabase's Site URL must be exactly your production origin — a mismatch means the fallback redirect (and any relative redirectTo) lands on the wrong domain.`,
            where: 'supabase.siteUrl',
          });
          fixes.push({ title: 'Set Site URL to match app.productionOrigin', value: productionOrigin, where: 'Supabase → Authentication → URL Configuration → Site URL' });
        }
      }
    }
  }

  // ── 3. Supabase project URL shape ───────────────────────────────────
  const projectUrl = safeStr(supabase.projectUrl).trim();
  if (projectUrl && !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(projectUrl) && !/^https:\/\/[a-z0-9.-]+\/?$/i.test(projectUrl)) {
    problems.push({
      severity: 'medium',
      code: 'project_url_unusual',
      message: `"${projectUrl}" doesn't look like a standard https://<ref>.supabase.co project URL. If this is a custom auth domain, confirm it's mapped correctly — otherwise check for a typo.`,
      where: 'supabase.projectUrl',
    });
  } else if (!projectUrl) {
    problems.push({
      severity: 'low',
      code: 'missing_project_url',
      message: "supabase.projectUrl is empty, so the exact OAuth provider callback URL can't be computed or verified.",
      where: 'supabase.projectUrl',
    });
  }

  // ── 4. callback URL covered by the Supabase redirect allow-list? ────
  const allowList = Array.isArray(supabase.allowedRedirectUrls)
    ? supabase.allowedRedirectUrls.filter((x) => typeof x === 'string' && x.trim())
    : [];

  if (callbackUrl) {
    const directMatch = matchesAnyAllowlist(callbackUrl, allowList);
    if (!directMatch) {
      const altValue = callbackUrl.endsWith('/') ? callbackUrl.slice(0, -1) : callbackUrl + '/';
      const matchesWithSlashFlip = matchesAnyAllowlist(altValue, allowList);
      if (matchesWithSlashFlip) {
        problems.push({
          severity: 'medium',
          code: 'allowlist_trailing_slash_mismatch',
          message: `Your allow-list covers "${altValue}" but the app's callback URL is "${callbackUrl}" — a trailing-slash mismatch. Supabase allow-list matching is exact per path segment, so this silently fails.`,
          where: 'supabase.allowedRedirectUrls',
        });
        fixes.push({ title: 'Fix the trailing slash in the allow-list entry', value: callbackUrl, where: 'Supabase → Authentication → URL Configuration → Redirect URLs' });
      } else {
        problems.push({
          severity: 'high',
          code: 'callback_not_allowlisted',
          message: `"${callbackUrl}" is not covered by any pattern in supabase.allowedRedirectUrls. Supabase will refuse the redirect and fall back to Site URL.`,
          where: 'supabase.allowedRedirectUrls',
        });
        fixes.push({ title: 'Add to Supabase → Auth → URL Configuration → Redirect URLs', value: callbackUrl, where: 'supabase.allowedRedirectUrls' });
      }
    }
  }

  const hasLocalhostEntry = allowList.some((p) => /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(p.trim()));
  if (hasLocalhostEntry) {
    checklist.push('A localhost entry is on your redirect allow-list for local development — that\'s expected and fine to keep alongside your production entry.');
  } else {
    checklist.push('If you also test OAuth locally, allow-list your dev callback too, e.g. "http://localhost:3000/auth/callback".');
  }

  if (deployedOn === 'vercel' && !allowList.some((p) => /vercel\.app/i.test(p))) {
    problems.push({
      severity: 'low',
      code: 'vercel_preview_not_allowlisted',
      message: 'Deployed on Vercel, but no *.vercel.app pattern is on the redirect allow-list — OAuth will fail on preview deployments (it will still work on production).',
      where: 'supabase.allowedRedirectUrls',
    });
    fixes.push({
      title: 'Allow-list Vercel preview deployments',
      value: 'https://*-<your-team-or-account-slug>.vercel.app/** (or the broader https://*.vercel.app/**)',
      where: 'Supabase → Authentication → URL Configuration → Redirect URLs',
    });
  } else if (deployedOn === 'netlify' && !allowList.some((p) => /netlify\.app/i.test(p))) {
    problems.push({
      severity: 'low',
      code: 'netlify_preview_not_allowlisted',
      message: 'Deployed on Netlify, but no *.netlify.app pattern is on the redirect allow-list — OAuth will fail on deploy previews (it will still work on production).',
      where: 'supabase.allowedRedirectUrls',
    });
    fixes.push({
      title: 'Allow-list Netlify deploy previews',
      value: 'https://**--<your-site-name>.netlify.app/**',
      where: 'Supabase → Authentication → URL Configuration → Redirect URLs',
    });
  }

  // ── 5. provider console has the exact Supabase callback? ───────────
  const providerName = ['google', 'github', 'apple', 'azure', 'discord', 'other'].includes(provider.name) ? provider.name : 'other';
  const providerUris = Array.isArray(provider.authorizedRedirectUris)
    ? provider.authorizedRedirectUris.filter((x) => typeof x === 'string' && x.trim())
    : [];

  if (supabaseCallback) {
    const providerHasCallback = providerUris.some((u) => trimTrailingSlash(u) === supabaseCallback);
    if (!providerHasCallback) {
      const prodHost = hostnameOf(productionOrigin);
      const pointsToApp = prodHost && providerUris.some((u) => hostnameOf(u) === prodHost);
      if (pointsToApp) {
        problems.push({
          severity: 'high',
          code: 'provider_uri_points_to_app',
          message: `${providerLabel(providerName)} has a redirect URI pointing at your own app's domain instead of the Supabase callback. In the OAuth handshake the provider redirects to Supabase first (${supabaseCallback}), and Supabase then redirects on to your app — your app's own URL never goes in the provider console.`,
          where: 'provider.authorizedRedirectUris',
        });
      } else {
        problems.push({
          severity: 'high',
          code: 'provider_redirect_uri_missing',
          message: `${providerLabel(providerName)} doesn't contain the exact URL "${supabaseCallback}". OAuth providers require an exact match here — wildcards aren't accepted.`,
          where: 'provider.authorizedRedirectUris',
        });
      }
      fixes.push({
        title: `Add the exact callback in the ${providerName === 'other' ? 'provider' : providerName} console`,
        value: supabaseCallback,
        where: providerLabel(providerName),
      });
    }
  }

  // ── 6. flowType / PKCE callback handler ──────────────────────────────
  if (flowType === 'pkce') {
    if (code.callbackRouteExists === false) {
      const snippet = callbackRouteSnippet(callbackPath);
      problems.push({
        severity: 'high',
        code: 'missing_callback_route',
        message: `flowType is pkce but no callback route exists at "${callbackPath}" yet. PKCE needs a server route that receives the ?code= param and exchanges it for a session — without it, users land on your app with a dead ?code= in the URL.`,
        where: 'code.callbackRouteExists',
      });
      fixes.push({ title: 'Add a PKCE callback route handler', value: snippet.code, where: snippet.where });
    } else if (code.callsExchangeCodeForSession === false) {
      problems.push({
        severity: 'high',
        code: 'missing_exchange_code_for_session',
        message: "flowType is pkce but the callback route isn't calling exchangeCodeForSession(code) yet. With PKCE, the callback URL carries a code param that must be exchanged for a session — it isn't a session by itself.",
        where: 'code.callsExchangeCodeForSession',
      });
      fixes.push({ title: 'Exchange the code for a session in the callback route', value: 'const { error } = await supabase.auth.exchangeCodeForSession(code);', where: `app${callbackPath}/route.ts` });
    }
  } else if (flowType === 'implicit') {
    if (ssrExpected) {
      problems.push({
        severity: 'medium',
        code: 'implicit_flow_with_ssr',
        message: 'flowType is implicit while using an SSR setup (Next.js / @supabase/ssr). Implicit flow returns the session in the URL fragment, which a server can\'t read — SSR helpers are built around PKCE\'s code-exchange step instead.',
        where: 'app.flowType',
      });
      fixes.push({ title: 'Switch to PKCE', value: "createBrowserClient(url, key) // @supabase/ssr defaults to PKCE — just add the callback route", where: 'supabase client options' });
    }
  } else if (!flowType && ssrExpected) {
    problems.push({
      severity: 'low',
      code: 'flow_type_not_set',
      message: 'app.flowType is not set. With an SSR package or Next.js, PKCE is the expected flow — confirm it explicitly so the callback route requirement below is accurate.',
      where: 'app.flowType',
    });
  }

  // ── 7. redirectTo snippet heuristics ─────────────────────────────────
  const snippet = safeStr(code.redirectToSnippet);
  if (!snippet.trim()) {
    problems.push({
      severity: 'medium',
      code: 'redirect_snippet_missing',
      message: 'No redirectTo snippet was provided. Without an explicit redirectTo, signInWithOAuth() falls back to Site URL — which only works if Site URL is exactly your production origin.',
      where: 'code.redirectToSnippet',
    });
  } else {
    if (/http:\/\/localhost/i.test(snippet)) {
      problems.push({
        severity: 'high',
        code: 'redirect_snippet_hardcoded_localhost',
        message: 'The redirectTo snippet hardcodes "http://localhost" — this ships to production verbatim and Supabase will reject it if it\'s not on the allow-list, then fall back to Site URL.',
        where: 'code.redirectToSnippet',
      });
      fixes.push({
        title: 'Derive redirectTo from an environment/origin value instead of hardcoding localhost',
        value: envSiteUrlVar
          ? `\`\${process.env.${envSiteUrlVar}}${callbackPath}\``
          : `\`\${window.location.origin}${callbackPath}\``,
        where: 'code.redirectToSnippet',
      });
    }
    if (/process\?\.\s*env/.test(snippet)) {
      problems.push({
        severity: 'high',
        code: 'redirect_snippet_optional_chaining_env',
        message: 'The snippet uses "process?.env" — optional chaining on `process` itself. In the browser bundle `process` is typically undefined, so `process?.env` short-circuits to `undefined` and the whole expression silently resolves to nothing (a real-world case reported in Supabase discussion #38063). Use `process.env.VAR` directly (bundlers statically replace it) or `import.meta.env.VAR` on Vite.',
        where: 'code.redirectToSnippet',
      });
      fixes.push({
        title: 'Remove the optional chaining on process',
        value: envSiteUrlVar ? `process.env.${envSiteUrlVar}` : 'process.env.NEXT_PUBLIC_SITE_URL',
        where: 'code.redirectToSnippet',
      });
    } else if (/window\.location\.origin/.test(snippet) && ssrExpected) {
      const hasGuard =
        /typeof\s+window/.test(snippet) ||
        /process\.env/.test(snippet) ||
        /import\.meta\.env/.test(snippet) ||
        (envSiteUrlVar && snippet.includes(envSiteUrlVar));
      if (!hasGuard) {
        problems.push({
          severity: 'low',
          code: 'redirect_snippet_origin_no_ssr_fallback',
          message: 'The snippet uses window.location.origin with no SSR-safe fallback. On the server (SSR render, route handler) there is no window — this throws or needs a guard in any code path that can run server-side.',
          where: 'code.redirectToSnippet',
        });
        fixes.push({
          title: 'Guard window.location.origin for SSR',
          value: envSiteUrlVar
            ? `typeof window !== 'undefined' ? window.location.origin : process.env.${envSiteUrlVar}`
            : "typeof window !== 'undefined' ? window.location.origin : process.env.NEXT_PUBLIC_SITE_URL",
          where: 'code.redirectToSnippet',
        });
      }
    }
  }

  checklist.push(callbackUrl
    ? `Add "${callbackUrl}" (your app's exact callback) to the Supabase redirect allow-list.`
    : 'Set app.productionOrigin so the exact callback URL can be checked.');
  checklist.push(supabaseCallback
    ? `Add "${supabaseCallback}" to ${providerLabel(providerName)} — exact match, no wildcards.`
    : 'Set supabase.projectUrl so the exact provider callback URL can be computed.');
  checklist.push('Use flowType: "pkce" and call exchangeCodeForSession(code) in your callback route.');
  checklist.push('Re-run this check after every deploy — Supabase settings and provider consoles drift independently from your code.');

  const sorted = sortProblems(problems);
  const highCount = sorted.filter((p) => p.severity === 'high').length;
  const medCount = sorted.filter((p) => p.severity === 'medium').length;
  const lowCount = sorted.filter((p) => p.severity === 'low').length;

  let status = 'pass';
  if (highCount > 0) status = 'fail';
  else if (medCount > 0 || lowCount > 0) status = 'warn';

  let summary;
  if (status === 'pass') {
    summary = 'No mismatches found. The callback URL your app will use is on the Supabase allow-list, and the provider console has the exact Supabase callback.';
  } else if (status === 'fail') {
    const top = sorted.find((p) => p.severity === 'high');
    summary = `${highCount} blocking mismatch${highCount > 1 ? 'es' : ''} found. Most urgent: ${top.message}`;
  } else {
    const top = sorted[0];
    summary = `Nothing blocking, but ${medCount + lowCount} thing${medCount + lowCount > 1 ? 's' : ''} worth fixing. Top of the list: ${top.message}`;
  }

  return {
    status,
    summary,
    expected,
    problems: sorted,
    fixes,
    checklist,
    disclaimer:
      'Read-only, client-side analysis of the values you entered. Nothing is verified against your live Supabase project or provider console — always confirm in your own environment before shipping.',
  };
}

/**
 * Standalone helper: just the expected values for a config, without running
 * the full diagnostic. Handy for live-updating a preview as the user types.
 */
export function expectedValues(config) {
  const cfg = config && typeof config === 'object' ? config : {};
  return computeExpected(cfg);
}

// Also expose as a plain browser global when loaded via <script type="module">.
if (typeof window !== 'undefined') {
  window.RedirectDoctorWeb = { diagnose, expectedValues };
}
