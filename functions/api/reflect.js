// Cloudflare Pages Function — POST /api/reflect
// Sends a reader's journal entry to Claude and returns ONE warm, open
// follow-up question for the free "Reflect With Me" tool at /reflect.
//
// Configure in the Cloudflare dashboard:
//   Pages project -> Settings -> Environment variables (Production + Preview)
//     ANTHROPIC_API_KEY  (secret) - from https://console.anthropic.com
//
// The key ONLY ever lives in this env var. Nothing is stored: the entry is used
// for a single request and discarded. Two safety layers guard the response.

// Layer 1: server-side crisis pre-screen. On a hit we NEVER call the model.
const CRISIS = /\b(kill(ing)? myself|suicid|end my life|want to die|don'?t want to (live|be here|be alive)|better off dead|hurt(ing)? myself|harm(ing)? myself|self[ -]?harm|cutting myself|hitting me|hits me|being abused|abusing me|not safe at home|i'?m not safe|can'?t go on)\b/i;

// Layer 2 + voice: baked into the system prompt.
const SYSTEM = [
  "You are a warm, grounded reflective companion inside a self-reflection journal",
  "for people living abroad, created by Stephanie, a licensed clinical social worker.",
  "The person has just written a journal entry. Respond with EXACTLY ONE gentle,",
  "open-ended follow-up question that invites them a little deeper, in a warm,",
  "second-person, non-clinical voice.",
  "Do NOT give advice, solutions, reassurance, interpretation, or diagnosis.",
  "Do NOT claim to be a therapist or that this is therapy.",
  "Keep it to one or two sentences. Do not use em-dashes or emojis.",
  "If the entry shows ANY sign of crisis (self-harm, suicidal thoughts, abuse, or",
  "being in danger), do NOT ask a question. Instead reply with exactly: CRISIS",
  "Return only the question (or the word CRISIS), nothing else."
].join(" ");

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "bad request" }, 400);
  }

  const entry = String((body && body.entryText) || "").slice(0, 4000).trim();
  if (entry.length < 4) return json({ error: "empty" }, 400);

  // Layer 1 — crisis pre-screen: skip the model entirely.
  if (CRISIS.test(entry)) return json({ crisis: true });

  if (!env.ANTHROPIC_API_KEY) return json({ error: "not configured" }, 500);

  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 150,
        system: SYSTEM,
        messages: [{ role: "user", content: entry }]
      })
    });
  } catch (err) {
    return json({ error: "upstream" }, 502);
  }

  if (!res.ok) return json({ error: "upstream", status: res.status }, 502);
  const data = await res.json();

  // Layer 2 — model declined for safety.
  if (data.stop_reason === "refusal") return json({ crisis: true });

  const q = (data.content || [])
    .filter(function (b) { return b.type === "text"; })
    .map(function (b) { return b.text; })
    .join(" ")
    .trim();

  if (!q) return json({ error: "no question" }, 502);
  if (/^crisis$/i.test(q)) return json({ crisis: true });  // Layer 2 belt-and-suspenders

  return json({ question: q });
}

export function onRequestGet() {
  return json({ error: "Method not allowed." }, 405);
}
