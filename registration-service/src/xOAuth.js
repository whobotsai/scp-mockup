// X (Twitter) OAuth 2.0 Authorization Code flow with PKCE, user-context.
//
// CAVEAT: the endpoint hostnames below are this module's best understanding of X's current
// OAuth 2.0 API surface, not something this codebase has completed a live round-trip against
// (this sandbox has no network access to X's API to verify it). Confirm both endpoints and
// the exact scopes against developer.x.com's current docs before relying on this -- all
// three are overridable via .env specifically so a wrong default doesn't require a code
// change to fix.
"use strict";

const AUTH_URL = process.env.X_AUTH_URL || "https://x.com/i/oauth2/authorize";
const TOKEN_URL = process.env.X_TOKEN_URL || "https://api.x.com/2/oauth2/token";
const USERINFO_URL = process.env.X_USERINFO_URL || "https://api.x.com/2/users/me";

// `offline.access` requests a refresh token; not used yet (registration is a one-time OAuth
// per wallet, per PRD section 12.2 -- "one registration covers every SSO campaign"), included
// so a future need to re-verify a handle doesn't require re-scoping an already-approved app.
const SCOPES = process.env.X_OAUTH_SCOPES || "users.read tweet.read offline.access";

function buildAuthorizeUrl({ state, codeChallenge, redirectUri, clientId }) {
  const url = new URL(AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function exchangeCodeForToken({ code, codeVerifier, redirectUri, clientId, clientSecret }) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    client_id: clientId,
  });

  // Confidential clients (this service holds a client secret) authenticate via HTTP Basic,
  // per RFC 6749 SS2.3.1 -- standard OAuth2, not X-specific.
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }
  return res.json(); // { access_token, token_type, expires_in, scope, refresh_token? }
}

async function fetchUserHandle(accessToken) {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Fetching user info failed: ${res.status} ${text}`);
  }
  const body = await res.json();
  const username = body?.data?.username;
  if (!username) throw new Error("User info response did not include a username");
  return `@${username}`;
}

module.exports = { buildAuthorizeUrl, exchangeCodeForToken, fetchUserHandle };
