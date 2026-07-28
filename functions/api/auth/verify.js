// POST /api/auth/verify  { token }   (token = the magic link's token)
// Exchanges a valid, unexpired magic-link token for a 30-day session token.
import { sign, verify, json } from "./_shared.js";

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days (me.js still re-checks Stripe every open)

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const token = (body && body.token) || "";
  if (!env.AUTH_SECRET) return json({ error: "Login is not configured yet." }, 500);

  const p = await verify(token, env.AUTH_SECRET);
  if (!p || p.purpose !== "login") {
    return json({ error: "This link is invalid or has expired. Please request a new one." }, 401);
  }
  const session = await sign({ email: p.email, purpose: "session", exp: Date.now() + SESSION_TTL_MS }, env.AUTH_SECRET);
  return json({ ok: true, session, email: p.email });
}
