// The Circle community feed — persistent, shared across all members, member-gated.
//   GET  /api/circle/posts?space=<space>   -> recent posts (optionally filtered by space)
//   POST /api/circle/posts { body, name, space } -> create a post as the signed-in member
// Storage = Cloudflare D1 bound as `env.DB` (see functions/_content/community-schema.sql).
import { authedMember, allowAttempt, json } from "../auth/_shared.js";

const MAX_BODY = 2000, MAX_NAME = 40, FEED_LIMIT = 200;
const SPACES = ["Welcome", "This month", "What I'm navigating", "Small wins", "Ask Stephanie"];

// Which authors show a "Host" badge (you). Kept in sync with authedMember's host rule.
function hostSet(env) {
  const a = (env.GATE_ALLOWLIST || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  const h = (env.CIRCLE_HOST || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  return new Set([...a, ...h]);
}

export async function onRequestGet({ request, env }) {
  const m = await authedMember(request, env);
  if (!m.ok) return json({ error: m.reason }, m.status);
  if (!env.DB) return json({ error: "The community is coming online shortly.", reason: "nodb" }, 503);

  const space = new URL(request.url).searchParams.get("space") || "";
  const filtered = space && SPACES.includes(space);
  const q = filtered
    ? env.DB.prepare("SELECT id,name,body,space,created_at,email FROM posts WHERE hidden=0 AND space=?1 ORDER BY created_at DESC LIMIT ?2").bind(space, FEED_LIMIT)
    : env.DB.prepare("SELECT id,name,body,space,created_at,email FROM posts WHERE hidden=0 ORDER BY created_at DESC LIMIT ?1").bind(FEED_LIMIT);

  let rows;
  try { rows = await q.all(); } catch { return json({ error: "Couldn't load the circle just now." }, 500); }
  const hosts = hostSet(env);
  const posts = (rows.results || []).map(r => ({
    id: r.id, name: r.name, body: r.body, space: r.space, ts: r.created_at,
    mine: r.email === m.email, host: hosts.has((r.email || "").toLowerCase()),
  }));
  return json({ ok: true, mod: m.host, posts });
}

export async function onRequestPost({ request, env, waitUntil }) {
  const m = await authedMember(request, env);
  if (!m.ok) return json({ error: m.reason }, m.status);
  if (!env.DB) return json({ error: "The community is coming online shortly." }, 503);

  let b; try { b = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const body = String((b && b.body) || "").trim().slice(0, MAX_BODY);
  const name = (String((b && b.name) || "").trim().slice(0, MAX_NAME)) || "Member";
  let space = String((b && b.space) || "This month");
  if (!SPACES.includes(space)) space = "This month";
  if (!body) return json({ error: "Write something first." }, 400);

  // Gentle anti-spam: cap posts per member.
  if (!(await allowAttempt("post:" + m.email, 8, 60))) {
    return json({ error: "You're posting quickly — take a breath and try again in a moment." }, 429);
  }

  const ts = Date.now();
  let res;
  try {
    res = await env.DB.prepare("INSERT INTO posts (email,name,space,body,created_at,hidden) VALUES (?1,?2,?3,?4,?5,0)")
      .bind(m.email, name, space, body, ts).run();
  } catch { return json({ error: "Couldn't post just now. Try again in a moment." }, 500); }

  // Nudge the host by email when a member (not the host) posts — throttled, best-effort.
  if (!m.host) {
    const job = notifyHost(env, { name, space, body });
    if (waitUntil) waitUntil(job); else await job.catch(() => {});
  }

  const id = res.meta && res.meta.last_row_id;
  return json({ ok: true, post: { id, name, body, space, ts, mine: true, host: m.host } });
}

// Email the host that there's new activity in The Circle. Throttled to at most one
// nudge every 10 minutes so a busy day can't flood the inbox — it's a gentle "come
// look," not a notification per post.
async function notifyHost(env, post) {
  if (!env.RESEND_API_KEY) return;
  if (!(await allowAttempt("hostnotify", 1, 600))) return;
  const to = env.HOST_EMAIL || "hello@thegroundedexpat.com";
  const preview = post.body.length > 260 ? post.body.slice(0, 260) + "…" : post.body;
  const esc = s => String(s || "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const link = "https://thegroundedexpat.com/app-929l2vmpvz1h/";
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;color:#2A2622;font-size:16px;line-height:1.6;max-width:460px">
    <p>There's new activity in <b>The Circle</b>.</p>
    <p style="background:#F6F1E7;border-radius:12px;padding:14px 16px;margin:18px 0">
      <b>${esc(post.name)}</b> posted in <b>${esc(post.space)}</b>:<br>
      <span style="color:#4a453d">${esc(preview)}</span>
    </p>
    <p style="margin:24px 0"><a href="${link}" style="background:#C2674A;color:#fff;text-decoration:none;padding:13px 26px;border-radius:100px;font-weight:600;display:inline-block">Open The Circle</a></p>
    <p style="color:#6E6557;font-size:13px">You're getting this because you host The Circle. (You'll get at most one nudge every 10 minutes.)</p>
  </div>`;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "The Grounded Expat <hello@thegroundedexpat.com>", to: [to], subject: "New post in The Circle 🌿", html }),
    });
  } catch { /* best effort */ }
}
