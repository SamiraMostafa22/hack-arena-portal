import crypto from "crypto";

const COOKIE_NAME = "team_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8; // 8 hours

function getSessionSecret() {
  const secret = process.env.TEAM_SESSION_SECRET;

  if (!secret) {
    throw new Error("Missing TEAM_SESSION_SECRET environment variable.");
  }

  return secret;
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value) {
  return crypto
    .createHmac("sha256", getSessionSecret())
    .update(value)
    .digest("base64url");
}

export function createTeamSessionValue(team) {
  const now = Math.floor(Date.now() / 1000);

  const payload = {
    v: 1,
    teamId: team.id,
    teamName: team.team_name,
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS,
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function verifyTeamSessionValue(sessionValue) {
  if (!sessionValue || typeof sessionValue !== "string") {
    return null;
  }

  const [encodedPayload, signature] = sessionValue.split(".");

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = sign(encodedPayload);

  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    const now = Math.floor(Date.now() / 1000);

    if (!payload.teamId || !payload.exp || payload.exp < now) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function getTeamSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function getTeamSessionCookieName() {
  return COOKIE_NAME;
}