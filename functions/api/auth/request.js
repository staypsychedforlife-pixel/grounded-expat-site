// POST /api/auth/request  { email }
// If the email has an active Circle subscription (or is allow-listed), emails a
// one-tap magic sign-in link via Resend. Always responds {ok:true} so the
// endpoint can't be used to discover who is a member.
import { sign, json, hasActiveSubscription, makeCode, currentWindow } from "./_shared.js";

const APP_PATH = "/app-929l2vmpvz1h/";       // where the app lives
const LINK_TTL_MS = 15 * 60 * 1000;          // magic link valid 15 minutes

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const email = String((body && body.email) || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Please enter a valid email." }, 400);
  if (!env.AUTH_SECRET) return json({ error: "Login is not configured yet." }, 500);

  // Allow-list (for you + testers/comps), then the real Stripe check.
  const allow = (env.GATE_ALLOWLIST || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  let isMember = allow.includes(email);
  if (!isMember && env.STRIPE_SECRET_KEY) {
    isMember = await hasActiveSubscription(email, env.STRIPE_SECRET_KEY, env.CIRCLE_PRICE_ID);
  }

  if (isMember) {
    const token = await sign({ email, purpose: "login", exp: Date.now() + LINK_TTL_MS }, env.AUTH_SECRET);
    const link = "https://thegroundedexpat.com" + APP_PATH + "?token=" + encodeURIComponent(token);
    const code = await makeCode(email, env.AUTH_SECRET, currentWindow());
    await sendMagicEmail(email, link, code, env.RESEND_API_KEY);
  }
  // Same response whether or not they're a member.
  return json({ ok: true });
}

async function sendMagicEmail(to, link, code, resendKey) {
  if (!resendKey) return;
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;color:#2A2622;font-size:16px;line-height:1.6;max-width:460px">
    <p>Hi there,</p>
    <p>Here's your code to sign in to <b>The Grounded Expat</b>. Type it into the app:</p>
    <p style="font-size:34px;letter-spacing:10px;font-weight:700;color:#2F4539;margin:20px 0 6px">${code}</p>
    <p style="color:#6E6557;font-size:13px;margin-top:0">It works for about 15 minutes.</p>
    <p style="margin-top:24px">On a computer? You can just tap this instead:</p>
    <p style="margin:14px 0 26px"><a href="${link}" style="background:#C2674A;color:#fff;text-decoration:none;padding:14px 28px;border-radius:100px;font-weight:600;display:inline-block">Open the app</a></p>
    <p style="color:#6E6557;font-size:13px">If you didn't request this, you can safely ignore it.<br>With care, Stephanie 🌿</p>
  </div>`;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + resendKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "The Grounded Expat <hello@thegroundedexpat.com>",
        to: [to],
        subject: "Your sign-in code 🌿",
        html,
      }),
    });
  } catch { /* best effort */ }
}
