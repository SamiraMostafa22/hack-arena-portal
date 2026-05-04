import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { cookies } from "next/headers";
import {
  getTeamSessionCookieName,
  verifyTeamSessionValue,
} from "@/lib/teamSession";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getTimeMs(value) {
  if (!value) return NaN;

  const text = String(value).trim();
  if (!text) return NaN;

  const hasTimezone = /z$/i.test(text) || /[+-]\d{2}:?\d{2}$/.test(text);
  const isoText = text.includes("T") ? text : text.replace(" ", "T");
  const normalized = hasTimezone ? isoText : `${isoText}Z`;

  return new Date(normalized).getTime();
}

function safeArray(value) {
  if (Array.isArray(value)) return value;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

async function getLoggedInTeam() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(getTeamSessionCookieName());
  const session = verifyTeamSessionValue(sessionCookie?.value);

  if (!session?.teamId) {
    return null;
  }

  return {
    id: session.teamId,
    teamName: session.teamName,
  };
}

function jsonResponse(payload, status = 200) {
  return Response.json(
    {
      serverNow: new Date().toISOString(),
      ...payload,
    },
    { status }
  );
}

function unauthorizedResponse() {
  return jsonResponse(
    {
      success: false,
      message: "Unauthorized. Please login again.",
    },
    401
  );
}

function timeClosedResponse(message = "Time is over. Hints are closed.") {
  return jsonResponse(
    {
      success: false,
      isExpired: true,
      message,
    },
    403
  );
}

function getRevealedAnswer(flag) {
  const questionType = String(flag.question_type || "flag").toLowerCase();

  if (questionType === "mcq") {
    const options = safeArray(flag.options);
    const correct = options.find(
      (option) => String(option.id) === String(flag.correct_option)
    );

    return correct?.text || "Correct answer is not available.";
  }

  if (questionType === "multi_input") {
    const fields = safeArray(flag.input_fields);
    const values = safeObject(flag.correct_values);

    if (fields.length > 0) {
      return fields
        .map((field) => `${field.label || field.id}: ${values[field.id] || ""}`)
        .join("\n");
    }

    return Object.entries(values)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
  }

  return flag.flag_code || "Correct answer is not available.";
}

async function checkCompetitionTime() {
  const { data: settings, error: settingsError } = await supabaseAdmin
    .from("competition_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (settingsError || !settings) {
    return {
      ok: false,
      message: "Competition settings not found.",
    };
  }

  const { data: activeRound, error: activeRoundError } = await supabaseAdmin
    .from("rounds")
    .select("*")
    .eq("is_active", true)
    .lte("round_number", 3)
    .order("round_number", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (activeRoundError || !activeRound) {
    return {
      ok: false,
      settings,
      message: "No active round now.",
    };
  }

  const startMs = getTimeMs(activeRound.start_time || settings.start_time);
  const endMs = getTimeMs(activeRound.end_time || settings.end_time);
  const nowMs = Date.now();

  const runningFlag =
    settings.is_running === true ||
    settings.is_active === true ||
    activeRound.is_active === true;

  if (!runningFlag || Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return {
      ok: false,
      settings,
      activeRound,
      message: "Competition is not active now.",
    };
  }

  if (nowMs < startMs) {
    return {
      ok: false,
      settings,
      activeRound,
      notStarted: true,
      message: "Round has not started yet.",
    };
  }

  if (nowMs >= endMs) {
    return {
      ok: false,
      settings,
      activeRound,
      expired: true,
      message: "Time is over. Hints are closed.",
    };
  }

  return {
    ok: true,
    settings,
    activeRound,
  };
}

async function checkPreviousChallenges({ teamId, flag }) {
  const { data: previousFlags, error: previousFlagsError } = await supabaseAdmin
    .from("flags")
    .select("id, challenge_order, question_type")
    .eq("round_id", flag.round_id)
    .eq("is_active", true)
    .lt("challenge_order", flag.challenge_order || 999)
    .order("challenge_order", { ascending: true });

  if (previousFlagsError) {
    return {
      allowed: false,
      message: "Could not check challenge order.",
    };
  }

  if (!previousFlags || previousFlags.length === 0) {
    return {
      allowed: true,
      message: "",
    };
  }

  const previousFlagIds = previousFlags.map((item) => item.id);

  const { data: previousSolves, error: previousSolvesError } =
    await supabaseAdmin
      .from("solves")
      .select("flag_id")
      .eq("team_id", teamId)
      .in("flag_id", previousFlagIds);

  if (previousSolvesError) {
    return {
      allowed: false,
      message: "Could not check previous solves.",
    };
  }

  const { data: previousProgress, error: previousProgressError } =
    await supabaseAdmin
      .from("team_flag_progress")
      .select("flag_id, is_completed")
      .eq("team_id", teamId)
      .in("flag_id", previousFlagIds);

  if (previousProgressError) {
    return {
      allowed: false,
      message:
        "Could not check previous progress. Make sure team_flag_progress table exists.",
    };
  }

  const previousMcqFlagIds = previousFlags
    .filter((item) => String(item.question_type || "").toLowerCase() === "mcq")
    .map((item) => item.id);

  let previousMcqAttempts = [];

  if (previousMcqFlagIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("submissions")
      .select("flag_id")
      .eq("team_id", teamId)
      .in("flag_id", previousMcqFlagIds)
      .like("submitted_flag", "MCQ_%");

    if (error) {
      return {
        allowed: false,
        message: "Could not check previous MCQ attempts.",
      };
    }

    previousMcqAttempts = data || [];
  }

  const passedPreviousIds = new Set([
    ...(previousSolves || []).map((solve) => solve.flag_id),
    ...(previousProgress || [])
      .filter((item) => item.is_completed)
      .map((item) => item.flag_id),
    ...(previousMcqAttempts || []).map((item) => item.flag_id),
  ]);

  const allPreviousPassed = previousFlagIds.every((id) =>
    passedPreviousIds.has(id)
  );

  if (!allPreviousPassed) {
    return {
      allowed: false,
      message:
        "This challenge is locked. Solve, answer, or use hint for the previous challenge first.",
    };
  }

  return {
    allowed: true,
    message: "",
  };
}

export async function POST(req) {
  try {
    const loggedInTeam = await getLoggedInTeam();

    if (!loggedInTeam?.id) {
      return unauthorizedResponse();
    }

    const teamId = loggedInTeam.id;

    const { flagId } = await req.json();

    if (!flagId) {
      return jsonResponse({
        success: false,
        message: "Missing challenge.",
      });
    }

    const timeCheck = await checkCompetitionTime();

    if (!timeCheck.ok) {
      return timeClosedResponse(
        timeCheck.notStarted
          ? "Round has not started yet."
          : "Time is over. Hints are closed."
      );
    }

    const { data: flag, error: flagError } = await supabaseAdmin
      .from("flags")
      .select("*, rounds(*)")
      .eq("id", flagId)
      .eq("is_active", true)
      .maybeSingle();

    if (flagError || !flag) {
      return jsonResponse({
        success: false,
        message: "Challenge not found.",
      });
    }

    if (!flag.rounds) {
      return jsonResponse({
        success: false,
        message: "Round data not found.",
      });
    }

    const roundNumber = Number(flag.rounds.round_number);

    if (roundNumber > 3) {
      return jsonResponse({
        success: false,
        message: "This challenge is not available.",
      });
    }

    if (roundNumber === 3) {
      return jsonResponse(
        {
          success: false,
          message: "Hints are disabled in Round 3.",
        },
        403
      );
    }

    if (!flag.rounds.is_active) {
      return jsonResponse({
        success: false,
        message: "This round is locked.",
      });
    }

    if (timeCheck.activeRound?.id && flag.round_id !== timeCheck.activeRound.id) {
      return jsonResponse({
        success: false,
        message: "This challenge is not in the active round.",
      });
    }

    const previousCheck = await checkPreviousChallenges({
      teamId,
      flag,
    });

    if (!previousCheck.allowed) {
      return jsonResponse({
        success: false,
        message: previousCheck.message,
      });
    }

    const revealedAnswer = getRevealedAnswer(flag);
    const now = new Date().toISOString();

    const { data: oldSolve, error: oldSolveError } = await supabaseAdmin
      .from("solves")
      .select("id, is_hint, points")
      .eq("team_id", teamId)
      .eq("flag_id", flag.id)
      .maybeSingle();

    if (oldSolveError) {
      return jsonResponse({
        success: false,
        message: "Could not check old solve.",
      });
    }

    const { data: oldHint, error: oldHintError } = await supabaseAdmin
      .from("team_hints")
      .select("id, hint_text")
      .eq("team_id", teamId)
      .eq("flag_id", flag.id)
      .maybeSingle();

    if (oldHintError) {
      return jsonResponse({
        success: false,
        message:
          "Could not check old hint. Make sure team_hints table exists.",
      });
    }

    if (oldSolve && !oldSolve.is_hint) {
      await supabaseAdmin.from("team_flag_progress").upsert(
        {
          team_id: teamId,
          flag_id: flag.id,
          round_id: flag.round_id,
          is_completed: true,
          is_correct: true,
          last_submitted_answer: "ALREADY_SOLVED",
          completed_at: now,
        },
        {
          onConflict: "team_id,flag_id",
        }
      );

      return jsonResponse({
        success: true,
        isCompleted: true,
        isHint: false,
        pointsAwarded: Number(oldSolve.points || 0),
        revealedAnswer,
        hint: revealedAnswer,
        message: "This challenge was already solved normally.",
      });
    }

    if (oldHint || oldSolve?.is_hint) {
      await supabaseAdmin.from("team_flag_progress").upsert(
        {
          team_id: teamId,
          flag_id: flag.id,
          round_id: flag.round_id,
          is_completed: true,
          is_correct: false,
          last_submitted_answer: "HINT_REVEALED",
          completed_at: now,
        },
        {
          onConflict: "team_id,flag_id",
        }
      );

      return jsonResponse({
        success: true,
        isCompleted: true,
        isHint: true,
        pointsAwarded: 0,
        revealedAnswer: oldHint?.hint_text || revealedAnswer,
        hint: oldHint?.hint_text || revealedAnswer,
        message: "Hint already used. This challenge gives 0 points.",
      });
    }

    const { error: hintError } = await supabaseAdmin.from("team_hints").upsert(
      {
        team_id: teamId,
        flag_id: flag.id,
        hint_text: revealedAnswer,
        created_at: now,
      },
      {
        onConflict: "team_id,flag_id",
      }
    );

    if (hintError) {
      return jsonResponse({
        success: false,
        message: "Could not save hint: " + hintError.message,
      });
    }

    const { error: progressError } = await supabaseAdmin
      .from("team_flag_progress")
      .upsert(
        {
          team_id: teamId,
          flag_id: flag.id,
          round_id: flag.round_id,
          is_completed: true,
          is_correct: false,
          last_submitted_answer: "HINT_REVEALED",
          completed_at: now,
        },
        {
          onConflict: "team_id,flag_id",
        }
      );

    if (progressError) {
      return jsonResponse({
        success: false,
        message: "Could not update progress: " + progressError.message,
      });
    }

    await supabaseAdmin.from("submissions").insert({
      team_id: teamId,
      flag_id: flag.id,
      submitted_flag: "HINT_REVEALED",
      is_correct: false,
      points_awarded: 0,
      submitted_at: now,
    });

    const { error: solveError } = await supabaseAdmin.from("solves").insert({
      team_id: teamId,
      flag_id: flag.id,
      round_id: flag.round_id,
      points: 0,
      is_hint: true,
      solved_at: now,
    });

    if (solveError) {
      return jsonResponse({
        success: false,
        message: "Could not unlock challenge using hint: " + solveError.message,
      });
    }

    return jsonResponse({
      success: true,
      isCompleted: true,
      isHint: true,
      pointsAwarded: 0,
      revealedAnswer,
      hint: revealedAnswer,
      message: "Hint revealed. No points awarded. Next challenge is unlocked.",
    });
  } catch (error) {
    return jsonResponse({
      success: false,
      message: "Server error: " + error.message,
    });
  }
}