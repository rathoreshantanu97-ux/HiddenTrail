// ---------------------------------------------------------------------------
// notify-access-request
//
// Called directly by the client right after request_access() succeeds,
// passing along the OTP it got back, so this function's only job is
// "send an email". See src/lib/accessControlApi.js requestAccess() for
// the calling code.
//
// SETUP REQUIRED (see README "Access control setup" section):
//   1. Sign up at resend.com (free tier).
//   2. Get an API key.
//   3. supabase secrets set RESEND_API_KEY=... and OWNER_EMAIL=...
//   4. Deploy this function: supabase functions deploy notify-access-request
//   5. (Resend free tier without a verified domain can only send TO the
//      email address your Resend account is registered under -- so
//      OWNER_EMAIL must match that.)
//
// IMPORTANT: browsers send a CORS "preflight" OPTIONS request before the
// real POST whenever calling a cross-origin endpoint like this one (which
// is exactly how supabase.functions.invoke() calls it from the browser).
// Without explicitly handling that OPTIONS request, Deno.serve's default
// handler falls through into the same code that expects a POST body,
// tries to read/parse an empty OPTIONS body as JSON, and crashes with
// "SyntaxError: Unexpected end of JSON input" -- which silently prevented
// the POST from ever being processed, so no email was ever actually sent
// even though supabase.functions.invoke() on the client reported success
// (it doesn't distinguish "the browser's preflight succeeded" from "your
// actual handler logic ran").
// ---------------------------------------------------------------------------

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  // Handle the CORS preflight request FIRST, before anything tries to
  // read a body -- this is the fix for the bug described above.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { username, displayName, otp } = await req.json();

    if (!username || !otp) {
      return new Response(JSON.stringify({ error: "Missing username or otp" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const OWNER_EMAIL = Deno.env.get("OWNER_EMAIL");

    if (!RESEND_API_KEY || !OWNER_EMAIL) {
      console.error("RESEND_API_KEY or OWNER_EMAIL not configured");
      return new Response(JSON.stringify({ error: "Email not configured on server" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const emailResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Scotland Yard <onboarding@resend.dev>",
        to: [OWNER_EMAIL],
        subject: `Access request: ${displayName || username}`,
        html: `
          <p><strong>${displayName || username}</strong> (username: <code>${username}</code>) is requesting access to Scotland Yard.</p>
          <p>Their one-time code is:</p>
          <p style="font-size: 28px; font-weight: 700; letter-spacing: 4px;">${otp}</p>
          <p>This code expires in 30 minutes. Share it with them directly (text, call, in person) -- do not forward this email.</p>
        `,
      }),
    });

    if (!emailResp.ok) {
      const errText = await emailResp.text();
      console.error("Resend API error:", errText);
      return new Response(JSON.stringify({ error: "Failed to send email", detail: errText }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
