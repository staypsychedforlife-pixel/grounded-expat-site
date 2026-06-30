// Cloudflare Pages Function — POST /api/submit
// Receives The Grounded Expat waitlist / contact forms and emails the
// submission to the business inbox via Resend (https://resend.com).
//
// Configure these in the Cloudflare dashboard:
//   Pages project → Settings → Environment variables (Production + Preview)
//     RESEND_API_KEY  (secret)  – from https://resend.com/api-keys
//     LEAD_TO                   – inbox that receives signups, e.g. "hello@thegroundedexpat.com"
//     LEAD_FROM                 – a VERIFIED Resend sender, e.g.
//                                 "The Grounded Expat <noreply@thegroundedexpat.com>"
//                                 (you can reuse a sender already verified on
//                                  anchorpointpartners.co until the new domain is verified)
//
// Nothing here contains secrets — the API key only ever lives in the env var.

const FORM_LABELS = {
  "grounded-waitlist": "The Grounded Expat — new waitlist signup",
  "contact": "The Grounded Expat — contact message"
};

const PINE = "#2F4539", CLAY = "#C2674A";

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[<>&]/g, function (c) {
    return c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;";
  });
}

function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ""));
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let data;
  try {
    const ct = request.headers.get("content-type") || "";
    if (ct.indexOf("application/json") !== -1) {
      data = await request.json();
    } else {
      const fd = await request.formData();
      data = {};
      for (const [k, v] of fd) data[k] = v;
    }
  } catch (err) {
    return json({ ok: false, error: "Could not read the submission." }, 400);
  }

  // Honeypot: bots fill this hidden field. Accept silently, send nothing.
  if (data._gotcha) return json({ ok: true });

  if (!isEmail(data.email)) {
    return json({ ok: false, error: "A valid email address is required." }, 400);
  }

  const key = String(data._form || "grounded-waitlist");
  const label = FORM_LABELS[key] || "The Grounded Expat — website form";

  if (!env.RESEND_API_KEY || !env.LEAD_TO || !env.LEAD_FROM) {
    return json({ ok: false, error: "Email delivery is not configured yet." }, 500);
  }

  const rows = [
    ["Form", label],
    ["Name", data.name],
    ["Email", data.email],
    ["Message", data.message]
  ].filter(function (r) { return r[1]; });

  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;color:' + PINE + ';">' +
    '<h2 style="font-weight:600;margin:0 0 16px;color:' + CLAY + ';">' + escapeHtml(label) + "</h2>" +
    '<table style="border-collapse:collapse;font-size:14px;">' +
    rows.map(function (r) {
      return '<tr><td style="padding:6px 16px 6px 0;color:' + PINE +
        ';vertical-align:top;white-space:nowrap;"><strong>' + escapeHtml(r[0]) +
        '</strong></td><td style="padding:6px 0;">' +
        escapeHtml(r[1]).replace(/\n/g, "<br>") + "</td></tr>";
    }).join("") +
    "</table>" +
    '<p style="font-size:12px;color:#999;margin-top:24px;">Sent from thegroundedexpat.com</p>' +
    "</div>";

  const text = rows.map(function (r) { return r[0] + ": " + r[1]; }).join("\n");

  const payload = {
    from: env.LEAD_FROM,
    to: [env.LEAD_TO],
    reply_to: data.email,
    subject: label + (data.name ? " — " + data.name : ""),
    html: html,
    text: text
  };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + env.RESEND_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const detail = await res.text();
      return json({ ok: false, error: "Email service rejected the request.", detail: detail }, 502);
    }
  } catch (err) {
    return json({ ok: false, error: "Could not reach the email service." }, 502);
  }

  // Best-effort: email the subscriber their welcome + free journal.
  // Requires LEAD_FROM to be a sender on a Resend-verified domain
  // (e.g. "The Grounded Expat <hello@thegroundedexpat.com>"). If the domain
  // isn't verified, Resend rejects this send and we ignore it — the on-screen
  // journal link is the fallback, so the signup itself still succeeds.
  if (key === "grounded-waitlist") {
    const journalUrl = "https://thegroundedexpat.com/first-7-days/";
    const wHtml =
      '<div style="background:#F6F1E7;padding:28px 14px;font-family:Georgia,serif;color:#2A2622;">' +
        '<div style="max-width:520px;margin:0 auto;background:#FBF8F1;border-radius:16px;padding:34px 30px;">' +
          '<p style="font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:3px;font-size:11px;font-weight:bold;color:#8C9B82;margin:0 0 18px;">The Grounded Expat</p>' +
          '<h1 style="font-family:Georgia,serif;font-weight:normal;font-size:27px;line-height:1.15;color:#2F4539;margin:0 0 14px;">You&rsquo;re in. 🌿</h1>' +
          '<p style="font-size:16px;line-height:1.6;margin:0 0 14px;">Welcome &mdash; I&rsquo;m so glad you&rsquo;re here.</p>' +
          '<p style="font-size:16px;line-height:1.6;margin:0 0 14px;">Your free mini-journal, <em>Your First 7 Days Abroad</em>, is ready whenever you are &mdash; a gentle, day-by-day companion for the overwhelming first week in a new country.</p>' +
          '<p style="text-align:center;margin:26px 0;"><a href="' + journalUrl + '" style="font-family:Arial,sans-serif;background:#C2674A;color:#FBF8F1;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 30px;border-radius:999px;display:inline-block;">Open your journal &rarr;</a></p>' +
          '<p style="font-size:14px;line-height:1.6;color:#6E6557;margin:0 0 14px;">A small tip: it saves your writing automatically on whatever device you open it on &mdash; so bookmark the page and come back to it through your week.</p>' +
          '<p style="font-size:16px;line-height:1.6;margin:0 0 4px;">I&rsquo;ll be in touch now and then with more tools for the inner side of living abroad. You can unsubscribe any time.</p>' +
          '<p style="font-size:16px;line-height:1.6;margin:18px 0 0;">Warmly,<br>Stephanie</p>' +
          '<p style="font-family:Arial,sans-serif;font-size:13px;color:#8C9B82;margin:4px 0 0;">Stephanie Johnson, LICSW &middot; The Grounded Expat</p>' +
        '</div>' +
        '<p style="font-family:Arial,sans-serif;text-align:center;font-size:11px;color:#9C9587;margin:16px 0 0;">You received this because you signed up at thegroundedexpat.com.</p>' +
      '</div>';
    const wText =
      "You're in! Welcome to The Grounded Expat.\n\n" +
      "Your free mini-journal, Your First 7 Days Abroad, is ready:\n" +
      journalUrl + "\n\n" +
      "It saves your writing automatically on whatever device you open it on — bookmark it and come back to it through your week.\n\n" +
      "I'll be in touch now and then with more tools for the inner side of living abroad. Unsubscribe any time.\n\n" +
      "Warmly,\nStephanie\nStephanie Johnson, LICSW · The Grounded Expat";
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + env.RESEND_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: env.LEAD_FROM,
          to: [String(data.email)],
          reply_to: env.LEAD_TO,
          subject: "Your free journal — Your First 7 Days Abroad",
          html: wHtml,
          text: wText
        })
      });
    } catch (e) {
      // Best-effort only; never fail the signup over the welcome email.
    }
  }

  return json({ ok: true });
}

export function onRequestGet() {
  return json({ ok: false, error: "Method not allowed." }, 405);
}
