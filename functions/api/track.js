// Minimal, privacy-first usage analytics — anonymous aggregate counts only.
//   POST /api/track { event }   -> record one event (no email, no IP, no identifiers stored)
//   GET  /api/track?stats=1     -> aggregate totals (host only)
// Storage = the same Cloudflare D1 (env.DB); see analytics-schema.sql.
import { verify, authedMember, allowAttempt, json } from "./auth/_shared.js";

const EVENTS = ["open", "reflect", "post", "library", "workshop", "practice"];

// Record an event. We only store the event name and the calendar day — never who
// did it. We do require a validly-signed session so bots can't inflate the numbers,
// but we don't store anything that identifies the member.
export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: true });
  let b; try { b = await request.json(); } catch { return json({ ok: true }); }
  const name = String((b && b.event) || "");
  if (!EVENTS.includes(name)) return json({ ok: true });

  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = env.AUTH_SECRET ? await verify(token, env.AUTH_SECRET) : null;
  if (!p || p.purpose !== "session") return json({ ok: true }); // ignore signed-out / invalid

  const ip = request.headers.get("CF-Connecting-IP") || "0";
  if (!(await allowAttempt("trk:" + ip, 120, 60))) return json({ ok: true }); // backstop only

  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  try {
    await env.DB.prepare("INSERT INTO events (name, day, created_at) VALUES (?1, ?2, ?3)")
      .bind(name, day, Date.now()).run();
  } catch { /* best effort */ }
  return json({ ok: true });
}

// Aggregate stats — host only.
export async function onRequestGet({ request, env }) {
  const m = await authedMember(request, env);
  if (!m.ok) return json({ error: m.reason }, m.status);
  if (!m.host) return json({ error: "Not allowed." }, 403);
  if (!env.DB) return json({ error: "No storage." }, 503);

  const since = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10); // last 7 days incl today
  let all, wk;
  try {
    all = await env.DB.prepare("SELECT name, COUNT(*) c FROM events GROUP BY name").all();
    wk = await env.DB.prepare("SELECT name, COUNT(*) c FROM events WHERE day >= ?1 GROUP BY name").bind(since).all();
  } catch { return json({ error: "Couldn't read stats." }, 500); }

  const totals = {}, last7 = {};
  (all.results || []).forEach(r => totals[r.name] = r.c);
  (wk.results || []).forEach(r => last7[r.name] = r.c);
  return json({ ok: true, totals, last7 });
}
