// ---------------------------------------------------------------------------
// notify-access-request
//
// Triggered by a Supabase Database Webhook on INSERT into access_requests.
// Looks up the plaintext OTP (which the request_access() RPC generated and
// discarded from its own return value in normal client use -- here we
// regenerate nothing; instead this function is called directly BY the
// client right after request_access() succeeds, passing along the OTP it
// got back, so this function's only job is "send an email", not "look up
// a secret". See src/lib/accessControlApi.js requestAccess() for the
// calling code.
//
// SETUP REQUIRED (see README "Access control setup" section):
//   1. Sign up at resend.com (free tier).
//   2. Get an API key.
//   3. In Supabase Dashboard -> Edge Functions -> Secrets, add:
//        RESEND_API_KEY = <your key>
//        OWNER_EMAIL    = <your own email address, where OTPs get sent>
//   4. Deploy this function: supabase functions deploy notify-access-request
//   5. (Resend free tier without a verified domain can only send TO the
//      account owner's own email address -- which is exactly what we
//      want here, since OWNER_EMAIL should be the same email your Resend
//      account is registered under.)
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  try {
    const { username, displayName, otp } = await req.json();

    if (!username || !otp) {
      return new Response(JSON.stringify({ error: "Missing username or otp" }), { status: 400 });
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const OWNER_EMAIL = Deno.env.get("OWNER_EMAIL");

    if (!RESEND_API_KEY || !OWNER_EMAIL) {
      console.error("RESEND_API_KEY or OWNER_EMAIL not configured");
      return new Response(JSON.stringify({ error: "Email not configured on server" }), { status: 500 });
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
      return new Response(JSON.stringify({ error: "Failed to send email" }), { status: 502 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
