// GET /api/content?slug=<slug>   (Authorization: Bearer <session token>)
// Serves membership-INCLUDED content (the two free-with-membership journals and the
// 12 Circle workshops) live, and ONLY to an active member. The HTML lives in the
// non-public bundle at functions/_content/library.js, so it is never reachable at a
// direct URL — the only way in is through this gate. Cancel a membership and the very
// next open returns 403. This is the "no download-everything-then-cancel" rule.
import { verify, json, hasActiveSubscription } from "./auth/_shared.js";
import { CONTENT } from "../_content/library.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const slug = (url.searchParams.get("slug") || "").trim();
  const html = CONTENT[slug];
  if (!html) return json({ error: "Not found." }, 404);

  const gate = await checkMember(request, env);
  if (!gate.ok) return json({ error: gate.reason, reason: gate.code }, gate.status);

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}

// Same subscription logic as /api/auth/me: a validly signed session PLUS an active
// Circle subscription (allow-list bypasses; if Stripe isn't wired, trust the signature).
async function checkMember(request, env) {
  if (!env.AUTH_SECRET) return { ok: false, status: 500, code: "config", reason: "Access is not configured yet." };
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const p = await verify(token, env.AUTH_SECRET);
  if (!p || p.purpose !== "session") return { ok: false, status: 401, code: "signin", reason: "Please sign in." };

  const allow = (env.GATE_ALLOWLIST || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  let active = allow.includes(p.email);
  if (!active && env.STRIPE_SECRET_KEY) {
    active = await hasActiveSubscription(p.email, env.STRIPE_SECRET_KEY, env.CIRCLE_PRICE_ID);
  } else if (!active && !env.STRIPE_SECRET_KEY) {
    active = true;
  }
  if (!active) return { ok: false, status: 403, code: "inactive", reason: "Your membership isn't active." };
  return { ok: true };
}
