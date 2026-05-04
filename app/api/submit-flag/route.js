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

function maskFlag(flag) {
  if (!flag || flag.length <= 6) return "***";
  return flag.slice(0, 3) + "***" + flag.slice(-3);
}

function normalizeFlag(flag) {
  return String(flag || "").trim();
}

function normalizeCompare(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
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

function stringifyMultiInput(answerValues) {
  try {
    return JSON.stringify(answerValues || {});
  } catch {
    return "MULTI_INPUT_SUBMITTED";
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

function unauthorizedResponse() {
  return Response.json(
    {
      success: false,
      isCorrect: false,
      message: "Unauthorized. Please login again.",
      serverNow: new Date().toISOString(),
    },
    { status: 401 }
  );
}

function wrongResponse(extra = {}) {
  return Response.json({
    success: false,
    isCorrect: false,
    message: "Wrong answer.",
    serverNow: new Date().toISOString(),
    ...extra,
  });
}

function correctResponse(extra = {}) {
  return Response.json({
    success: true,
    isCorrect: true,
    message: "Correct answer.",
    serverNow: new Date().toISOString(),
    ...extra,
  });
}

function timeClosedResponse(message = "Time is over. Submissions are closed.") {
  return Response.json(
    {
      success: false,
      isCorrect: false,
      isExpired: true,
      message,
      serverNow: new Date().toISOString(),
    },
    { status: 403 }
  );
}

function hasColumn(row, columnName) {
  return Object.prototype.hasOwnProperty.call(row || {}, columnName);
}

async function closeCompetition(settings) {
  const updatePayload = {};

  if (hasColumn(settings, "is_running")) {
    updatePayload.is_running = false;
  }

  if (hasColumn(settings, "is_active")) {
    updatePayload.is_active = false;
  }

  if (Object.keys(updatePayload).length > 0) {
    await supabaseAdmin
      .from("competition_settings")
      .update(updatePayload)
      .eq("id", 1);
  }

  await supabaseAdmin
    .from("rounds")
    .update({ is_active: false })
    .eq("is_active", true);
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
      settings: null,
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

  const startTimeValue = activeRound.start_time || settings.start_time;
  const endTimeValue = activeRound.end_time || settings.end_time;

  const startMs = getTimeMs(startTimeValue);
  const endMs = getTimeMs(endTimeValue);
  const nowMs = Date.now();

  const hasValidStart = !Number.isNaN(startMs);
  const hasValidEnd = !Number.isNaN(endMs);

  const runningFlag =
    settings.is_running === true ||
    settings.is_active === true ||
    activeRound.is_active === true;

  if (!runningFlag || !hasValidStart || !hasValidEnd) {
    return {
      ok: false,
      settings,
      activeRound,
      message: "Competition is not running.",
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
    await closeCompetition(settings);

    return {
      ok: false,
      settings,
      activeRound,
      expired: true,
      message: "Time is over. Submissions are closed.",
    };
  }

  return {
    ok: true,
    settings,
    activeRound,
  };
}

async function saveProgress({
  teamId,
  flagId,
  roundId,
  isCompleted,
  isCorrect,
  lastSubmittedAnswer,
}) {
  const { error } = await supabaseAdmin.from("team_flag_progress").upsert(
    {
      team_id: teamId,
      flag_id: flagId,
      round_id: roundId,
      is_completed: isCompleted,
      is_correct: isCorrect,
      last_submitted_answer: String(lastSubmittedAnswer || ""),
      completed_at: new Date().toISOString(),
    },
    {
      onConflict: "team_id,flag_id",
    }
  );

  if (error) {
    return {
      success: false,
      message: "Wrong answer.",
    };
  }

  return { success: true };
}

async function recalculateTeamScore(teamId) {
  const { data: solves, error } = await supabaseAdmin
    .from("solves")
    .select("points, is_hint")
    .eq("team_id", teamId);

  if (error) return;

  const totalScore = (solves || [])
    .filter((solve) => !solve.is_hint)
    .reduce((sum, solve) => {
      return sum + Number(solve.points || 0);
    }, 0);

  await supabaseAdmin
    .from("teams")
    .update({ total_score: totalScore })
    .eq("id", teamId);
}

async function checkSequentialAccess(teamId, flag) {
  const { data: previousFlags, error: previousFlagsError } = await supabaseAdmin
    .from("flags")
    .select("id, challenge_order, question_type")
    .eq("round_id", flag.round_id)
    .eq("is_active", true)
    .lt("challenge_order", flag.challenge_order || 999)
    .order("challenge_order", { ascending: true });

  if (previousFlagsError) {
    return {
      ok: false,
      message: "Wrong answer.",
    };
  }

  if ((previousFlags || []).length === 0) {
    return { ok: true };
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
      ok: false,
      message: "Wrong answer.",
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
      ok: false,
      message: "Wrong answer.",
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
        ok: false,
        message: "Wrong answer.",
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
      ok: false,
      message: "Wrong answer.",
    };
  }

  return { ok: true };
}

async function handleCorrectSolve({
  teamId,
  flag,
  submittedAnswer,
  shouldLogSubmission = true,
}) {
  const { data: oldSolve, error: oldSolveError } = await supabaseAdmin
    .from("solves")
    .select("id, is_hint, points")
    .eq("team_id", teamId)
    .eq("flag_id", flag.id)
    .maybeSingle();

  if (oldSolveError) {
    return {
      success: false,
      isCorrect: false,
      message: "Wrong answer.",
      serverNow: new Date().toISOString(),
    };
  }

  if (oldSolve) {
    await saveProgress({
      teamId,
      flagId: flag.id,
      roundId: flag.round_id,
      isCompleted: true,
      isCorrect: !oldSolve.is_hint,
      lastSubmittedAnswer: oldSolve.is_hint
        ? "HINT_REVEALED"
        : submittedAnswer || "ALREADY_SOLVED",
    });

    if (oldSolve.is_hint) {
      return {
        success: false,
        isCorrect: false,
        isCompleted: true,
        alreadyDone: true,
        moveToNext: true,
        pointsAwarded: 0,
        message: "This challenge was revealed by hint. No points awarded.",
        serverNow: new Date().toISOString(),
      };
    }

    return {
      success: true,
      isCorrect: true,
      isCompleted: true,
      alreadyDone: true,
      pointsAwarded: Number(oldSolve.points || 0),
      message: "Correct answer.",
      serverNow: new Date().toISOString(),
    };
  }

  let firstBlood = false;

  const { error: firstBloodError } = await supabaseAdmin
    .from("first_bloods")
    .insert({
      flag_id: flag.id,
      team_id: teamId,
      round_id: flag.round_id,
      solved_at: new Date().toISOString(),
    });

  if (!firstBloodError) {
    firstBlood = true;
  }

  const { error: solveError } = await supabaseAdmin.from("solves").insert({
    team_id: teamId,
    flag_id: flag.id,
    round_id: flag.round_id,
    points: Number(flag.points || 0),
    is_hint: false,
    solved_at: new Date().toISOString(),
  });

  if (solveError) {
    return {
      success: true,
      isCorrect: true,
      isCompleted: true,
      message: "Correct answer.",
      serverNow: new Date().toISOString(),
    };
  }

  if (shouldLogSubmission) {
    await supabaseAdmin.from("submissions").insert({
      team_id: teamId,
      flag_id: flag.id,
      submitted_flag: String(submittedAnswer || "CORRECT"),
      is_correct: true,
      points_awarded: Number(flag.points || 0),
      submitted_at: new Date().toISOString(),
    });
  }

  const progressResult = await saveProgress({
    teamId,
    flagId: flag.id,
    roundId: flag.round_id,
    isCompleted: true,
    isCorrect: true,
    lastSubmittedAnswer: submittedAnswer || "CORRECT",
  });

  if (!progressResult.success) {
    return {
      success: false,
      isCorrect: false,
      message: "Wrong answer.",
      serverNow: new Date().toISOString(),
    };
  }

  await recalculateTeamScore(teamId);

  return {
    success: true,
    isCorrect: true,
    isCompleted: true,
    firstBlood,
    points: Number(flag.points || 0),
    pointsAwarded: Number(flag.points || 0),
    message: "Correct answer.",
    serverNow: new Date().toISOString(),
  };
}

export async function POST(req) {
  try {
    const loggedInTeam = await getLoggedInTeam();

    if (!loggedInTeam?.id) {
      return unauthorizedResponse();
    }

    const teamId = loggedInTeam.id;

    const { submittedFlag, flagId, selectedOption, answerValues } =
      await req.json();

    const timeCheck = await checkCompetitionTime();

    if (!timeCheck.ok) {
      return timeClosedResponse(
        timeCheck.notStarted
          ? "Round has not started yet."
          : "Time is over. Submissions are closed."
      );
    }

    let flag = null;
    let fetchedById = false;
    let originalSubmittedAnswer = "";

    if (flagId) {
      fetchedById = true;

      const { data, error } = await supabaseAdmin
        .from("flags")
        .select("*, rounds(*)")
        .eq("id", flagId)
        .eq("is_active", true)
        .maybeSingle();

      if (error || !data) {
        return wrongResponse();
      }

      flag = data;
    } else {
      if (!submittedFlag) {
        return wrongResponse();
      }

      const cleanFlag = normalizeFlag(submittedFlag);
      originalSubmittedAnswer = cleanFlag;

      const { data, error } = await supabaseAdmin
        .from("flags")
        .select("*, rounds(*)")
        .eq("flag_code", cleanFlag)
        .eq("is_active", true)
        .maybeSingle();

      if (error || !data) {
        await supabaseAdmin.from("submissions").insert({
          team_id: teamId,
          submitted_flag: maskFlag(cleanFlag),
          is_correct: false,
          points_awarded: 0,
          submitted_at: new Date().toISOString(),
        });

        return wrongResponse();
      }

      flag = data;
    }

    if (!flag.rounds) {
      return wrongResponse();
    }

    if (Number(flag.rounds.round_number) > 3) {
      return wrongResponse();
    }

    if (!flag.rounds.is_active) {
      await supabaseAdmin.from("submissions").insert({
        team_id: teamId,
        flag_id: flag.id,
        submitted_flag: "LOCKED_ROUND_ATTEMPT",
        is_correct: false,
        points_awarded: 0,
        submitted_at: new Date().toISOString(),
      });

      return wrongResponse();
    }

    const sequential = await checkSequentialAccess(teamId, flag);

    if (!sequential.ok) {
      await supabaseAdmin.from("submissions").insert({
        team_id: teamId,
        flag_id: flag.id,
        submitted_flag: "LOCKED_CHALLENGE_ATTEMPT",
        is_correct: false,
        points_awarded: 0,
        submitted_at: new Date().toISOString(),
      });

      return wrongResponse();
    }

    const questionType = String(flag.question_type || "flag").toLowerCase();

    if (questionType === "mcq") {
      if (!selectedOption) {
        return Response.json({
          success: false,
          isCorrect: false,
          message: "Please choose an answer.",
          serverNow: new Date().toISOString(),
        });
      }

      const { data: oldSolve, error: oldSolveError } = await supabaseAdmin
        .from("solves")
        .select("id, is_hint, points")
        .eq("team_id", teamId)
        .eq("flag_id", flag.id)
        .maybeSingle();

      if (oldSolveError) {
        return wrongResponse();
      }

      if (oldSolve) {
        await saveProgress({
          teamId,
          flagId: flag.id,
          roundId: flag.round_id,
          isCompleted: true,
          isCorrect: !oldSolve.is_hint,
          lastSubmittedAnswer: oldSolve.is_hint
            ? "HINT_REVEALED"
            : "ALREADY_SOLVED",
        });

        if (oldSolve.is_hint) {
          return wrongResponse({
            isCompleted: true,
            alreadyDone: true,
            moveToNext: true,
            pointsAwarded: 0,
            message: "This challenge was revealed by hint. No points awarded.",
          });
        }

        return correctResponse({
          isCompleted: true,
          alreadyDone: true,
          pointsAwarded: Number(oldSolve.points || 0),
        });
      }

      const { data: oldProgress, error: oldProgressError } =
        await supabaseAdmin
          .from("team_flag_progress")
          .select("id, is_completed, is_correct")
          .eq("team_id", teamId)
          .eq("flag_id", flag.id)
          .maybeSingle();

      if (oldProgressError) {
        return wrongResponse();
      }

      if (oldProgress?.is_completed) {
        return wrongResponse({
          isCompleted: true,
          mcqAttempted: true,
          moveToNext: true,
          pointsAwarded: 0,
        });
      }

      const { data: oldMcqAttempt, error: oldMcqAttemptError } =
        await supabaseAdmin
          .from("submissions")
          .select("id")
          .eq("team_id", teamId)
          .eq("flag_id", flag.id)
          .like("submitted_flag", "MCQ_%")
          .limit(1);

      if (oldMcqAttemptError) {
        return wrongResponse();
      }

      if ((oldMcqAttempt || []).length > 0) {
        await saveProgress({
          teamId,
          flagId: flag.id,
          roundId: flag.round_id,
          isCompleted: true,
          isCorrect: false,
          lastSubmittedAnswer: "MCQ_ALREADY_ATTEMPTED",
        });

        return wrongResponse({
          isCompleted: true,
          mcqAttempted: true,
          moveToNext: true,
          pointsAwarded: 0,
        });
      }

      const cleanOption = normalizeFlag(selectedOption);
      const correctOption = normalizeFlag(flag.correct_option);
      const isCorrect = cleanOption === correctOption;

      await supabaseAdmin.from("submissions").insert({
        team_id: teamId,
        flag_id: flag.id,
        submitted_flag: `MCQ_${cleanOption}`,
        is_correct: isCorrect,
        points_awarded: isCorrect ? Number(flag.points || 0) : 0,
        submitted_at: new Date().toISOString(),
      });

      if (!isCorrect) {
        const progressResult = await saveProgress({
          teamId,
          flagId: flag.id,
          roundId: flag.round_id,
          isCompleted: true,
          isCorrect: false,
          lastSubmittedAnswer: `MCQ_${cleanOption}`,
        });

        if (!progressResult.success) {
          return wrongResponse();
        }

        return wrongResponse({
          isCompleted: true,
          mcqAttempted: true,
          moveToNext: true,
          pointsAwarded: 0,
        });
      }

      const result = await handleCorrectSolve({
        teamId,
        flag,
        submittedAnswer: `MCQ_${cleanOption}`,
        shouldLogSubmission: false,
      });

      return Response.json({
        ...result,
        message: result.isCorrect ? "Correct answer." : "Wrong answer.",
        serverNow: new Date().toISOString(),
      });
    }

    if (questionType === "multi_input") {
      const correctValues = safeObject(flag.correct_values);
      const submittedValues = safeObject(answerValues || {});
      const requiredKeys = Object.keys(correctValues);

      const missingField = requiredKeys.find(
        (key) => !String(submittedValues[key] || "").trim()
      );

      if (missingField) {
        return Response.json({
          success: false,
          isCorrect: false,
          message: `Please enter value for ${missingField}.`,
          serverNow: new Date().toISOString(),
        });
      }

      const allCorrect = requiredKeys.every((key) => {
        const submittedValue = normalizeCompare(submittedValues[key]);
        const correctValue = normalizeCompare(correctValues[key]);

        return submittedValue === correctValue;
      });

      if (!allCorrect) {
        await supabaseAdmin.from("submissions").insert({
          team_id: teamId,
          flag_id: flag.id,
          submitted_flag: stringifyMultiInput(submittedValues),
          is_correct: false,
          points_awarded: 0,
          submitted_at: new Date().toISOString(),
        });

        return wrongResponse({
          isCompleted: false,
          pointsAwarded: 0,
        });
      }

      const result = await handleCorrectSolve({
        teamId,
        flag,
        submittedAnswer: stringifyMultiInput(submittedValues),
        shouldLogSubmission: true,
      });

      return Response.json({
        ...result,
        message: result.isCorrect ? "Correct answer." : "Wrong answer.",
        serverNow: new Date().toISOString(),
      });
    }

    if (questionType === "flag") {
      const cleanSubmittedFlag = normalizeFlag(submittedFlag);

      if (!cleanSubmittedFlag) {
        return wrongResponse();
      }

      if (fetchedById) {
        originalSubmittedAnswer = cleanSubmittedFlag;

        const correctFlag = normalizeFlag(flag.flag_code);

        if (cleanSubmittedFlag !== correctFlag) {
          await supabaseAdmin.from("submissions").insert({
            team_id: teamId,
            flag_id: flag.id,
            submitted_flag: maskFlag(cleanSubmittedFlag),
            is_correct: false,
            points_awarded: 0,
            submitted_at: new Date().toISOString(),
          });

          return wrongResponse();
        }
      }

      const result = await handleCorrectSolve({
        teamId,
        flag,
        submittedAnswer: originalSubmittedAnswer || cleanSubmittedFlag,
        shouldLogSubmission: true,
      });

      return Response.json({
        ...result,
        message: result.isCorrect ? "Correct answer." : "Wrong answer.",
        serverNow: new Date().toISOString(),
      });
    }

    return wrongResponse();
  } catch (error) {
    return wrongResponse();
  }
}