// POST /api/auth/code  { email, code }
// Phone-friendly sign-in: the member types the 6-digit code from their email
// straight into the app (never leaving it), so the session lands in the right
// place — unlike a magic link, which can open in a different browser than the app.
// Verifies the code, confirms an active membership, then issues a long session.
import { makeCode, currentWindow, allowAttempt, sign, json, hasActiveSubscription } from "./_shared.js";

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days (me.js still re-checks Stripe every open)

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const email = String((body && body.email) || "").trim().toLowerCase();
  const code = String((body && body.code) || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Please enter a valid email." }, 400);
  if (!/^\d{6}$/.test(code)) return json({ error: "Enter the 6-digit code from your email." }, 400);
  if (!env.AUTH_SECRET) return json({ error: "Login is not configured yet." }, 500);

  // Throttle guesses (per IP and per email) so the 6-digit code can't be brute-forced.
  const ip = request.headers.get("CF-Connecting-IP") || "0";
  if (!(await allowAttempt("otp-ip:" + ip, 10, 600)) || !(await allowAttempt("otp-em:" + email, 10, 600))) {
    return json({ error: "Too many tries. Wait a minute, then request a fresh code." }, 429);
  }

  // Accept the current or previous two windows (covers ~20–30 minutes), so a code
  // still works if the app reloaded and they came back to enter it a bit later.
  const win = currentWindow();
  const ok = code === await makeCode(email, env.AUTH_SECRET, win)
          || code === await makeCode(email, env.AUTH_SECRET, win - 1)
          || code === await makeCode(email, env.AUTH_SECRET, win - 2);
  if (!ok) return json({ error: "That code didn't match. Request a fresh one and try again." }, 401);

  // Only active members (or the allow-list) get a session.
  const allow = (env.GATE_ALLOWLIST || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  let member = allow.includes(email);
  if (!member && env.STRIPE_SECRET_KEY) {
    member = await hasActiveSubscription(email, env.STRIPE_SECRET_KEY, env.CIRCLE_PRICE_ID);
  } else if (!member && !env.STRIPE_SECRET_KEY) {
    member = true; // Stripe not wired yet — don't lock out during setup
  }
  if (!member) return json({ error: "We couldn't find an active membership for that email." }, 403);

  const session = await sign({ email, purpose: "session", exp: Date.now() + SESSION_TTL_MS }, env.AUTH_SECRET);
  return json({ ok: true, session, email });
}
