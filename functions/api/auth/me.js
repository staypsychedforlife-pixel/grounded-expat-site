// GET /api/auth/me   (Authorization: Bearer <session token>)
// Validates the session AND re-checks the subscription, so a canceled member is
// locked out the next time the app opens (the "no grab-everything-and-cancel" rule).
import { verify, json, hasActiveSubscription } from "./_shared.js";

export async function onRequestGet({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!env.AUTH_SECRET) return json({ error: "Login is not configured yet." }, 500);

  const p = await verify(token, env.AUTH_SECRET);
  if (!p || p.purpose !== "session") return json({ member: false }, 401);

  // Still a member? Allow-list bypasses the Stripe check.
  const allow = (env.GATE_ALLOWLIST || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  let active = allow.includes(p.email);
  if (!active && env.STRIPE_SECRET_KEY) {
    active = await hasActiveSubscription(p.email, env.STRIPE_SECRET_KEY, env.CIRCLE_PRICE_ID);
  } else if (!active && !env.STRIPE_SECRET_KEY) {
    // Stripe not wired yet — trust a validly signed session so setup isn't a lock-out.
    active = true;
  }
  if (!active) return json({ member: false, reason: "inactive" }, 403);
  return json({ member: true, email: p.email });
}
