import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { NextResponse } from "next/server";
import crypto from "crypto";
import {
  createTeamSessionValue,
  getTeamSessionCookieName,
  getTeamSessionCookieOptions,
} from "@/lib/teamSession";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HASH_PREFIX = "pbkdf2";
const HASH_ITERATIONS = 120000;
const HASH_KEY_LENGTH = 32;
const HASH_DIGEST = "sha256";

function normalizeTeamName(value) {
  return String(value || "").trim();
}

function normalizePassword(value) {
  return String(value || "");
}

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString("base64url");

  const hash = crypto
    .pbkdf2Sync(
      password,
      salt,
      HASH_ITERATIONS,
      HASH_KEY_LENGTH,
      HASH_DIGEST
    )
    .toString("base64url");

  return `${HASH_PREFIX}$${HASH_ITERATIONS}$${salt}$${hash}`;
}

function isHashedPassword(value) {
  return String(value || "").startsWith(`${HASH_PREFIX}$`);
}

function verifyHashedPassword(password, storedHash) {
  const parts = String(storedHash || "").split("$");

  if (parts.length !== 4) return false;

  const [prefix, iterationsText, salt, expectedHash] = parts;

  if (prefix !== HASH_PREFIX) return false;

  const iterations = Number(iterationsText);

  if (!Number.isFinite(iterations) || !salt || !expectedHash) {
    return false;
  }

  const actualHash = crypto
    .pbkdf2Sync(password, salt, iterations, HASH_KEY_LENGTH, HASH_DIGEST)
    .toString("base64url");

  const actualBuffer = Buffer.from(actualHash);
  const expectedBuffer = Buffer.from(expectedHash);

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function publicTeam(team) {
  return {
    id: team.id,
    team_name: team.team_name,
    total_score: team.total_score || 0,
    created_at: team.created_at || null,
  };
}

function json(payload, status = 200) {
  return NextResponse.json(payload, { status });
}

export async function POST(req) {
  try {
    const { teamName, password } = await req.json();

    const cleanTeamName = normalizeTeamName(teamName);
    const cleanPassword = normalizePassword(password);

    if (!cleanTeamName || !cleanPassword) {
      return json({
        success: false,
        message: "Team name and password are required",
      });
    }

    const { data: teams, error } = await supabaseAdmin
      .from("teams")
      .select("id, team_name, password, total_score, created_at")
      .ilike("team_name", cleanTeamName);

    if (error) {
      return json({
        success: false,
        message: "Database error: " + error.message,
      });
    }

    if (!teams || teams.length === 0) {
      return json({
        success: false,
        message: "Team name not found: " + cleanTeamName,
      });
    }

    const team = teams[0];

    let finalTeam = team;

    if (!team.password) {
      const hashedPassword = createPasswordHash(cleanPassword);

      const { data: updatedTeam, error: updateError } = await supabaseAdmin
        .from("teams")
        .update({ password: hashedPassword })
        .eq("id", team.id)
        .select("id, team_name, password, total_score, created_at")
        .single();

      if (updateError) {
        return json({
          success: false,
          message: "Could not set password: " + updateError.message,
        });
      }

      finalTeam = updatedTeam;
    } else if (isHashedPassword(team.password)) {
      const passwordOk = verifyHashedPassword(cleanPassword, team.password);

      if (!passwordOk) {
        return json({
          success: false,
          message: "Wrong password",
        });
      }
    } else {
      // Old plain-text password support.
      // If login succeeds, migrate it immediately to hashed password.
      if (team.password !== cleanPassword) {
        return json({
          success: false,
          message: "Wrong password",
        });
      }

      const hashedPassword = createPasswordHash(cleanPassword);

      const { data: updatedTeam, error: migrateError } = await supabaseAdmin
        .from("teams")
        .update({ password: hashedPassword })
        .eq("id", team.id)
        .select("id, team_name, password, total_score, created_at")
        .single();

      if (!migrateError && updatedTeam) {
        finalTeam = updatedTeam;
      }
    }

    const response = json({
      success: true,
      message: team.password
        ? "Login successful"
        : "Password created successfully",
      team: publicTeam(finalTeam),
    });

    response.cookies.set(
      getTeamSessionCookieName(),
      createTeamSessionValue(finalTeam),
      getTeamSessionCookieOptions()
    );

    return response;
  } catch (error) {
    return json({
      success: false,
      message: "Server error: " + error.message,
    });
  }
}