// GET /api/audio?track=<slug>   (Authorization: Bearer <session>)
// Streams a Circle grounding-practice audio file from R2, but ONLY to an active
// member. The files are not at any public URL — the only way to hear them is
// through this gate, so cancelling a membership stops access the next time.
// R2 bucket is bound as env.AUDIO. Keys = "<slug>.m4a".
import { authedMember } from "./auth/_shared.js";

const TRACKS = [
  "p01-arrival-reset", "p02-name-it-to-tame-it", "p03-home-in-my-body",
  "p04-values-touchstone", "p05-for-the-lonely-nights", "p06-self-compassion-break",
  "p07-soften-before-you-speak", "p08-one-thing-thats-mine", "p09-the-downshift",
  "p10-savoring-here", "p11-both-and", "p12-who-ive-become",
];

function err(msg, status) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { "Content-Type": "application/json" } });
}

export async function onRequestGet({ request, env }) {
  const m = await authedMember(request, env);
  if (!m.ok) return err(m.reason, m.status);
  if (!env.AUDIO) return err("The practices are coming online shortly.", 503);

  const track = (new URL(request.url).searchParams.get("track") || "").trim();
  if (!TRACKS.includes(track)) return err("Not found.", 404);

  const obj = await env.AUDIO.get(track + ".m4a");
  if (!obj) return err("Not found.", 404);

  const headers = new Headers();
  headers.set("Content-Type", "audio/mp4");
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  if (obj.size != null) headers.set("Content-Length", String(obj.size));
  return new Response(obj.body, { headers });
}
