/**
 * auth — the authentication boundary for the Benchmark Intelligence dashboard.
 *
 * Real auth is Clerk (`@clerk/express`). This module is the single seam the
 * rest of the server talks to, so:
 *   - route handlers never import `@clerk/express` directly;
 *   - tests mock THIS file (one small surface) instead of the Clerk SDK;
 *   - a machine with no Clerk keys still boots (APIs just 401) and can be
 *     run for local UI work with an explicit, non-production dev identity.
 *
 * Identity model: the Clerk `userId` is the ONLY authorization identity.
 * `name` / `email` are display-only snapshots and are never trusted for access
 * decisions.
 *
 * Env:
 *   CLERK_PUBLISHABLE_KEY   - safe to expose to the browser (Clerk designs it so)
 *   CLERK_SECRET_KEY        - server only, never logged, never sent to a client
 *   AUTH_DEV_USER           - LOCAL DEV ONLY. "userId|Display Name|email@x.com".
 *                             Ignored when CLERK_SECRET_KEY is set or
 *                             NODE_ENV=production. Lets `npm run dev` show the
 *                             signed-in experience without a Clerk project.
 */
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { clerkMiddleware, getAuth, clerkClient } from '@clerk/express';

const __dirname = dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(join(__dirname, '..', '.env')); } catch { /* env already set / no .env */ }

const HAS_CLERK = !!(process.env.CLERK_SECRET_KEY && process.env.CLERK_PUBLISHABLE_KEY);
const IS_PROD = process.env.NODE_ENV === 'production';

function devIdentity() {
  if (HAS_CLERK || IS_PROD) return null;
  const raw = process.env.AUTH_DEV_USER;
  if (!raw) return null;
  const [userId, name, email] = String(raw).split('|');
  if (!userId) return null;
  return { userId: userId.trim(), name: (name || '').trim() || null, email: (email || '').trim() || null, dev: true };
}

/**
 * Express middleware to install once, before the API routes. Wires Clerk's
 * request context when keys are present; a pass-through otherwise.
 */
export function authMiddleware() {
  if (HAS_CLERK) return clerkMiddleware();
  return (req, _res, next) => next();
}

/**
 * The authenticated identity for a request, or null.
 * `{ userId, name, email }` — userId is the authorization key.
 */
export function getIdentity(req) {
  if (HAS_CLERK) {
    try {
      const a = getAuth(req);
      if (a && a.userId) {
        const c = a.sessionClaims || {};
        return {
          userId: a.userId,
          name: c.name || c.fullName || c.first_name || null,
          email: c.email || c.primaryEmail || c.email_address || null,
        };
      }
    } catch { /* not signed in / bad token */ }
    return null;
  }
  return devIdentity();
}

/** Route guard: 401 (consistent, non-revealing) when there is no identity. */
export function requireUser(req, res, next) {
  const id = getIdentity(req);
  if (!id) return res.status(401).json({ error: 'Sign in to continue.' });
  req.identity = id;
  next();
}

/**
 * Best-effort display snapshot for a new request. Uses Clerk's server API
 * (one call, at request-creation time only). Falls back to whatever the
 * session claims carried, then to nulls. Never throws.
 */
export async function displaySnapshot(identity) {
  const out = { created_by: identity.userId, created_by_name: identity.name || null, created_by_email: identity.email || null };
  if (HAS_CLERK && (!out.created_by_name || !out.created_by_email)) {
    try {
      const u = await clerkClient.users.getUser(identity.userId);
      const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
      out.created_by_name = out.created_by_name || name || u.username || null;
      out.created_by_email = out.created_by_email
        || u.primaryEmailAddress?.emailAddress
        || u.emailAddresses?.[0]?.emailAddress
        || null;
    } catch { /* keep what we have */ }
  }
  return out;
}

/** Public, non-secret status for GET /api/config (drives the sign-in screen). */
export function authStatus() {
  return {
    configured: HAS_CLERK,
    publishableKey: HAS_CLERK ? (process.env.CLERK_PUBLISHABLE_KEY || null) : null,
    devMode: !HAS_CLERK && !!devIdentity(),
  };
}

/** True when a request's owner matches the identity. Legacy `null` never matches. */
export function ownedBy(record, userId) {
  return !!record && !!userId && record.created_by === userId;
}
