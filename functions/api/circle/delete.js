// POST /api/circle/delete { id }
// Removes a post. A member can remove their OWN post; a host (you) can remove ANY
// post — the moderation control for the community.
import { authedMember, json } from "../auth/_shared.js";

export async function onRequestPost({ request, env }) {
  const m = await authedMember(request, env);
  if (!m.ok) return json({ error: m.reason }, m.status);
  if (!env.DB) return json({ error: "The community is coming online shortly." }, 503);

  let b; try { b = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const id = parseInt((b && b.id), 10);
  if (!id) return json({ error: "bad request" }, 400);

  let row;
  try { row = await env.DB.prepare("SELECT email FROM posts WHERE id=?1").bind(id).first(); }
  catch { return json({ error: "Couldn't remove that just now." }, 500); }
  if (!row) return json({ ok: true }); // already gone

  if (row.email !== m.email && !m.host) return json({ error: "You can only remove your own posts." }, 403);

  try { await env.DB.prepare("DELETE FROM posts WHERE id=?1").bind(id).run(); }
  catch { return json({ error: "Couldn't remove that just now." }, 500); }
  return json({ ok: true });
}
