// Shared auth helpers — stateless HMAC-signed tokens (no database needed).
// A token is  base64url(JSON payload) + "." + base64url(HMAC-SHA256 signature).
// Files starting with "_" are NOT routes; this is imported by the auth endpoints.

const enc = new TextEncoder();

function b64url(buf) {
  let s = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function sign(payload, secret) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return body + "." + b64url(sig);
}

export async function verify(token, secret) {
  if (!token || token.indexOf(".") < 0) return null;
  const [body, sig] = token.split(".");
  let ok;
  try { ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(sig), enc.encode(body)); }
  catch { return null; }
  if (!ok) return null;
  let p;
  try { p = JSON.parse(new TextDecoder().decode(fromB64url(body))); } catch { return null; }
  if (!p.exp || Date.now() > p.exp) return null;
  return p;
}

export function json(o, status) {
  return new Response(JSON.stringify(o), { status: status || 200, headers: { "Content-Type": "application/json" } });
}

// LIVE gate: does this email have an active Circle subscription in Stripe?
// If priceId is given, only that price counts (so other Stripe purchases don't
// grant membership). Returns false safely on any error. An email may map to
// more than one Stripe customer, so we check them all.
export async function hasActiveSubscription(email, stripeKey, priceId) {
  try {
    const cRes = await fetch("https://api.stripe.com/v1/customers?email=" + encodeURIComponent(email) + "&limit=10",
      { headers: { Authorization: "Bearer " + stripeKey } });
    const c = await cRes.json();
    const custs = (c.data || []);
    if (!custs.length) return false;
    for (const cust of custs) {
      let url = "https://api.stripe.com/v1/subscriptions?customer=" + cust.id + "&status=active&limit=10";
      if (priceId) url += "&price=" + encodeURIComponent(priceId);
      const s = await (await fetch(url, { headers: { Authorization: "Bearer " + stripeKey } })).json();
      if (s.data && s.data.length) return true;
    }
    return false;
  } catch { return false; }
}
