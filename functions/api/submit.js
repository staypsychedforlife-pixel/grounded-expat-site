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

  return json({ ok: true });
}

export function onRequestGet() {
  return json({ ok: false, error: "Method not allowed." }, 405);
}
