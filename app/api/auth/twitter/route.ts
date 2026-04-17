import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export async function GET(req: NextRequest) {
  const clientId = process.env.X_CLIENT_ID;
  const appUrl   = process.env.NEXT_PUBLIC_APP_URL ?? "https://ctwc.vercel.app";

  if (!clientId) {
    return NextResponse.json({ error: "X OAuth not configured" }, { status: 500 });
  }

  // Generate PKCE pair
  const codeVerifier  = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  const nonce         = crypto.randomBytes(8).toString("hex");

  // Embed verifier in state so we don't depend on cookies across redirects
  // Format: nonce|base64url(codeVerifier)
  const state = `${nonce}|${codeVerifier}`;

  const params = new URLSearchParams({
    response_type:         "code",
    client_id:             clientId,
    redirect_uri:          `${appUrl}/api/auth/twitter/callback`,
    scope:                 "tweet.read users.read",
    state,
    code_challenge:        codeChallenge,
    code_challenge_method: "S256",
  });

  return NextResponse.redirect(
    `https://twitter.com/i/oauth2/authorize?${params.toString()}`
  );
}
