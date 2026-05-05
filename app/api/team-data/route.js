import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { cookies } from "next/headers";
import {
  getTeamSessionCookieName,
  verifyTeamSessionValue,
} from "@/lib/teamSession";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

function jsonNoCache(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      ...NO_CACHE_HEADERS,
      ...(init.headers || {}),
    },
  });
}

function toTime(value) {
  if (!value) return null;

  const text = String(value).trim();
  if (!text) return null;

  const hasTimezone = /z$/i.test(text) || /[+-]\d{2}:?\d{2}$/.test(text);
  const isoText = text.includes("T") ? text : text.replace(" ", "T");
  const normalized = hasTimezone ? isoText : `${isoText}Z`;

  const date = new Date(normalized);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isAfter(a, b) {
  if (!a) return false;
  if (!b) return true;

  return new Date(a).getTime() > new Date(b).getTime();
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

function getTeamName(team) {
  return (
    team?.team_name ||
    team?.name ||
    team?.username ||
    team?.title ||
    `Team ${team?.id}`
  );
}

function isHintProgress(item) {
  const answer = String(item?.last_submitted_answer || "").toUpperCase();
  return item?.is_completed && !item?.is_correct && answer === "HINT_REVEALED";
}

function isMcqSubmission(value) {
  return String(value || "").startsWith("MCQ_");
}

function getRevealedAnswer(flag) {
  const questionType = String(flag?.question_type || "flag").toLowerCase();

  if (questionType === "mcq") {
    const options = safeArray(flag?.options);
    const correct = options.find(
      (option) => String(option.id) === String(flag?.correct_option)
    );

    return correct?.text || "Correct answer is not available.";
  }

  if (questionType === "multi_input") {
    const fields = safeArray(flag?.input_fields);
    const values = safeObject(flag?.correct_values);

    if (fields.length > 0) {
      return fields
        .map((field) => `${field.label || field.id}: ${values[field.id] || ""}`)
        .join("\n");
    }

    return Object.entries(values)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
  }

  return flag?.flag_code || "Correct answer is not available.";
}

function displaySubmittedAnswer(flag, submittedFlag) {
  const value = String(submittedFlag || "");

  if (!value) return "";

  const questionType = String(flag?.question_type || "flag").toLowerCase();

  if (value === "HINT_REVEALED") {
    return "Hint revealed";
  }

  if (questionType === "mcq" && value.startsWith("MCQ_")) {
    const optionId = value.replace("MCQ_", "");
    const options = safeArray(flag?.options);
    const option = options.find((item) => String(item.id) === String(optionId));

    return option?.text || optionId;
  }

  if (questionType === "multi_input") {
    try {
      const parsed = JSON.parse(value);

      if (parsed && typeof parsed === "object") {
        return Object.entries(parsed)
          .map(([key, val]) => `${key}: ${val}`)
          .join("\n");
      }
    } catch {
      return value;
    }
  }

  return value;
}

function findByTeamId(list, teamId) {
  return (list || []).find((item) => String(item.id) === String(teamId));
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

function unauthorizedResponse(serverNow) {
  return jsonNoCache(
    {
      success: false,
      message: "Unauthorized. Please login again.",
      serverNow,
    },
    { status: 401 }
  );
}

export async function GET() {
  const serverNow = new Date().toISOString();

  try {
    const loggedInTeam = await getLoggedInTeam();

    if (!loggedInTeam?.id) {
      return unauthorizedResponse(serverNow);
    }

    const teamId = loggedInTeam.id;

    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("competition_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (settingsError || !settings) {
      return jsonNoCache({
        success: false,
        message: "Competition settings not found.",
        serverNow,
      });
    }

    const { data: rounds, error: roundsError } = await supabaseAdmin
      .from("rounds")
      .select("*")
      .lte("round_number", 3)
      .order("round_number", { ascending: true });

    if (roundsError) {
      return jsonNoCache({
        success: false,
        message: "Rounds error: " + roundsError.message,
        serverNow,
      });
    }

    const safeRounds = rounds || [];
    const roundIds = safeRounds.map((round) => round.id);
    const activeRound = safeRounds.find((round) => round.is_active) || null;

    const timerSettings = {
      ...settings,
      start_time: activeRound?.start_time || settings.start_time || null,
      end_time: activeRound?.end_time || settings.end_time || null,
    };

    if (roundIds.length === 0) {
      return jsonNoCache({
        success: true,
        settings: timerSettings,
        activeRound: null,
        roundsProgress: [],
        stats: {
          score: 0,
          solved: 0,
          hints: 0,
          firstBlood: 0,
          rank: 0,
        },
        leaderboard: [],
        solvedAnswers: [],
        usedHints: [],
        historyItems: [],
        serverNow,
      });
    }

    const { data: flags, error: flagsError } = await supabaseAdmin
      .from("flags")
      .select(
        "id, round_id, flag_title, flag_code, points, difficulty, estimated_time, is_active, challenge_order, question_type, options, input_fields, correct_values, correct_option, hint_text"
      )
      .in("round_id", roundIds)
      .eq("is_active", true);

    if (flagsError) {
      return jsonNoCache({
        success: false,
        message: "Flags error: " + flagsError.message,
        serverNow,
      });
    }

    const safeFlags = flags || [];
    const flagIds = safeFlags.map((flag) => flag.id);

    const { data: teams, error: teamsError } = await supabaseAdmin
      .from("teams")
      .select("id, team_name, created_at")
      .order("created_at", { ascending: true });

    if (teamsError) {
      return jsonNoCache({
        success: false,
        message: "Teams error: " + teamsError.message,
        serverNow,
      });
    }

    let solves = [];
    let submissions = [];
    let hints = [];
    let progress = [];
    let firstBloods = [];

    const { data: solvesData, error: solvesError } = await supabaseAdmin
      .from("solves")
      .select("id, team_id, flag_id, round_id, points, solved_at, is_hint")
      .in("round_id", roundIds);

    if (solvesError) {
      return jsonNoCache({
        success: false,
        message: "Solves error: " + solvesError.message,
        serverNow,
      });
    }

    solves = solvesData || [];

    // Load First Blood only for UI display.
    // It does NOT affect ranking.
    const { data: firstBloodsData, error: firstBloodsError } =
      await supabaseAdmin
        .from("first_bloods")
        .select("*")
        .in("round_id", roundIds);

    if (!firstBloodsError) {
      firstBloods = firstBloodsData || [];
    }

    if (flagIds.length > 0) {
      const { data: submissionsData, error: submissionsError } =
        await supabaseAdmin
          .from("submissions")
          .select(
            "id, team_id, flag_id, submitted_flag, is_correct, points_awarded, submitted_at"
          )
          .in("flag_id", flagIds);

      if (submissionsError) {
        return jsonNoCache({
          success: false,
          message: "Submissions error: " + submissionsError.message,
          serverNow,
        });
      }

      submissions = submissionsData || [];

      const { data: hintsData, error: hintsError } = await supabaseAdmin
        .from("team_hints")
        .select("id, team_id, flag_id, hint_text, created_at")
        .in("flag_id", flagIds);

      if (hintsError) {
        return jsonNoCache({
          success: false,
          message:
            "Hints error: " +
            hintsError.message +
            ". Make sure team_hints table exists.",
          serverNow,
        });
      }

      hints = hintsData || [];

      const { data: progressData, error: progressError } = await supabaseAdmin
        .from("team_flag_progress")
        .select(
          "id, team_id, flag_id, round_id, is_completed, is_correct, last_submitted_answer, completed_at"
        )
        .in("flag_id", flagIds);

      if (progressError) {
        return jsonNoCache({
          success: false,
          message:
            "Progress error: " +
            progressError.message +
            ". Make sure team_flag_progress table exists.",
          serverNow,
        });
      }

      progress = progressData || [];
    }

    const flagById = new Map(safeFlags.map((flag) => [flag.id, flag]));
    const roundById = new Map(safeRounds.map((round) => [round.id, round]));

    const totalsByRoundNumber = {
      1: 0,
      2: 0,
      3: 0,
    };

    for (const flag of safeFlags) {
      const round = roundById.get(flag.round_id);
      const roundNumber = Number(round?.round_number);

      if (roundNumber >= 1 && roundNumber <= 3) {
        totalsByRoundNumber[roundNumber] += 1;
      }
    }

    const teamStats = new Map();

    for (const team of teams || []) {
      teamStats.set(team.id, {
        id: team.id,
        teamId: team.id,
        team_name: getTeamName(team),
        teamName: getTeamName(team),

        score: 0,
        totalScore: 0,

        solved: 0,
        solvedCount: 0,

        completed: 0,
        hints: 0,

        // First Blood appears in UI only.
        // It does NOT affect ranking.
        firstBloods: 0,

        lastSubmit: null,
        lastScoreTime: null,

        // مجموع وقت حل كل سؤال من بداية الراوند الخاص به.
        totalSolveTimeMs: 0,

        rounds: {
          1: 0,
          2: 0,
          3: 0,
        },

        roundsProgress: [1, 2, 3].map((roundNumber) => ({
          roundNumber,
          solved: 0,
          hints: 0,
          completed: 0,
          score: 0,
          total: totalsByRoundNumber[roundNumber] || 0,
        })),
      });
    }

    const countedNormalSolves = new Set();
    const countedHints = new Set();
    const countedCompleted = new Set();

    function getTeamStat(teamIdValue) {
      return Array.from(teamStats.values()).find(
        (item) => String(item.id) === String(teamIdValue)
      );
    }

    function addNormalSolve({
      teamId: solveTeamId,
      flagId,
      roundId,
      points,
      solvedAt,
    }) {
      const team = getTeamStat(solveTeamId);
      const flag = flagById.get(flagId);
      const round = roundById.get(roundId || flag?.round_id);

      if (!team || !flag || !round) return;

      const uniqueKey = `${solveTeamId}-${flagId}`;

      if (countedNormalSolves.has(uniqueKey)) return;

      countedNormalSolves.add(uniqueKey);

      const roundNumber = Number(round.round_number);
      const awardedPoints = Number(points || flag.points || 0);
      const solveTime = toTime(solvedAt);
      const roundStartTime = toTime(round.start_time);

      if (solveTime && roundStartTime) {
        const solveMs = new Date(solveTime).getTime();
        const roundStartMs = new Date(roundStartTime).getTime();

        team.totalSolveTimeMs += Math.max(0, solveMs - roundStartMs);
      }

      team.score += awardedPoints;
      team.totalScore += awardedPoints;
      team.solved += 1;
      team.solvedCount += 1;

      team.rounds[roundNumber] =
        Number(team.rounds[roundNumber] || 0) + awardedPoints;

      if (isAfter(solveTime, team.lastSubmit)) {
        team.lastSubmit = solveTime;
      }

      if (isAfter(solveTime, team.lastScoreTime)) {
        team.lastScoreTime = solveTime;
      }

      const roundProgress = team.roundsProgress.find(
        (item) => item.roundNumber === roundNumber
      );

      if (roundProgress) {
        roundProgress.solved += 1;
        roundProgress.score += awardedPoints;
      }
    }

    function addHint({ teamId: hintTeamId, flagId, createdAt }) {
      const team = getTeamStat(hintTeamId);
      const flag = flagById.get(flagId);

      if (!team || !flag) return;

      const round = roundById.get(flag.round_id);
      const roundNumber = Number(round?.round_number);
      const uniqueKey = `${hintTeamId}-${flagId}`;

      if (countedHints.has(uniqueKey)) return;

      countedHints.add(uniqueKey);
      team.hints += 1;

      const hintTime = toTime(createdAt);

      if (isAfter(hintTime, team.lastSubmit)) {
        team.lastSubmit = hintTime;
      }

      const roundProgress = team.roundsProgress.find(
        (item) => item.roundNumber === roundNumber
      );

      if (roundProgress) {
        roundProgress.hints += 1;
      }
    }

    function addCompleted({
      teamId: completedTeamId,
      flagId,
      completedAt,
    }) {
      const team = getTeamStat(completedTeamId);
      const flag = flagById.get(flagId);

      if (!team || !flag) return;

      const round = roundById.get(flag.round_id);
      const roundNumber = Number(round?.round_number);
      const uniqueKey = `${completedTeamId}-${flagId}`;

      if (countedCompleted.has(uniqueKey)) return;

      countedCompleted.add(uniqueKey);
      team.completed += 1;

      const completedTime = toTime(completedAt);

      if (isAfter(completedTime, team.lastSubmit)) {
        team.lastSubmit = completedTime;
      }

      const roundProgress = team.roundsProgress.find(
        (item) => item.roundNumber === roundNumber
      );

      if (roundProgress) {
        roundProgress.completed += 1;
      }
    }

    for (const solve of solves || []) {
      const solveTime = solve.solved_at;

      if (solve.is_hint) {
        addHint({
          teamId: solve.team_id,
          flagId: solve.flag_id,
          createdAt: solveTime,
        });

        addCompleted({
          teamId: solve.team_id,
          flagId: solve.flag_id,
          completedAt: solveTime,
        });

        continue;
      }

      addNormalSolve({
        teamId: solve.team_id,
        flagId: solve.flag_id,
        roundId: solve.round_id,
        points: solve.points,
        solvedAt: solveTime,
      });

      addCompleted({
        teamId: solve.team_id,
        flagId: solve.flag_id,
        completedAt: solveTime,
      });
    }

    for (const hint of hints || []) {
      addHint({
        teamId: hint.team_id,
        flagId: hint.flag_id,
        createdAt: hint.created_at,
      });
    }

    for (const item of progress || []) {
      if (!item.is_completed) continue;

      const completedTime = item.completed_at;

      addCompleted({
        teamId: item.team_id,
        flagId: item.flag_id,
        completedAt: completedTime,
      });

      if (item.is_correct) {
        addNormalSolve({
          teamId: item.team_id,
          flagId: item.flag_id,
          roundId: item.round_id,
          points: flagById.get(item.flag_id)?.points || 0,
          solvedAt: completedTime,
        });
      }

      if (isHintProgress(item)) {
        addHint({
          teamId: item.team_id,
          flagId: item.flag_id,
          createdAt: completedTime,
        });
      }
    }

    for (const submission of submissions || []) {
      const team = getTeamStat(submission.team_id);
      const flag = flagById.get(submission.flag_id);

      if (!team || !flag) continue;

      const submitTime = toTime(submission.submitted_at);

      if (isAfter(submitTime, team.lastSubmit)) {
        team.lastSubmit = submitTime;
      }

      if (submission.is_correct) {
        addNormalSolve({
          teamId: submission.team_id,
          flagId: submission.flag_id,
          roundId: flag.round_id,
          points: flag.points || submission.points_awarded || 0,
          solvedAt: submitTime,
        });

        addCompleted({
          teamId: submission.team_id,
          flagId: submission.flag_id,
          completedAt: submitTime,
        });
      }

      if (isMcqSubmission(submission.submitted_flag)) {
        addCompleted({
          teamId: submission.team_id,
          flagId: submission.flag_id,
          completedAt: submitTime,
        });
      }
    }

    // Count First Blood for UI display only.
    // Do NOT use it in leaderboard sorting.
    if (firstBloods.length > 0) {
      const countedFirstBloods = new Set();

      for (const blood of firstBloods) {
        const team = getTeamStat(blood.team_id);
        const key = `${blood.team_id}-${blood.flag_id || blood.id}`;

        if (!team || countedFirstBloods.has(key)) continue;

        countedFirstBloods.add(key);
        team.firstBloods += 1;
      }
    }

    const leaderboard = Array.from(teamStats.values()).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.solved !== a.solved) return b.solved - a.solved;

      const aTotalSolveTime =
        a.solved > 0 && Number.isFinite(a.totalSolveTimeMs)
          ? a.totalSolveTimeMs
          : Number.MAX_SAFE_INTEGER;

      const bTotalSolveTime =
        b.solved > 0 && Number.isFinite(b.totalSolveTimeMs)
          ? b.totalSolveTimeMs
          : Number.MAX_SAFE_INTEGER;

      if (aTotalSolveTime !== bTotalSolveTime) {
        return aTotalSolveTime - bTotalSolveTime;
      }

      return a.team_name.localeCompare(b.team_name);
    });

    leaderboard.forEach((team, index) => {
      team.rank = index + 1;
    });

    const selectedTeamStats =
      findByTeamId(leaderboard, teamId) || {
        score: 0,
        solved: 0,
        hints: 0,
        firstBloods: 0,
        rank: 0,
        totalSolveTimeMs: 0,
        roundsProgress: [1, 2, 3].map((roundNumber) => ({
          roundNumber,
          solved: 0,
          hints: 0,
          completed: 0,
          score: 0,
          total: totalsByRoundNumber[roundNumber] || 0,
        })),
      };

    const teamSolves = solves.filter(
      (item) => String(item.team_id) === String(teamId)
    );
    const teamSubmissions = submissions.filter(
      (item) => String(item.team_id) === String(teamId)
    );
    const teamHints = hints.filter(
      (item) => String(item.team_id) === String(teamId)
    );
    const teamProgress = progress.filter(
      (item) => String(item.team_id) === String(teamId)
    );

    const correctSubmissionMap = new Map();

    teamSubmissions
      .filter((submission) => submission.is_correct)
      .sort((a, b) => {
        const aTime = new Date(toTime(a.submitted_at) || 0).getTime();
        const bTime = new Date(toTime(b.submitted_at) || 0).getTime();

        return aTime - bTime;
      })
      .forEach((submission) => {
        if (!correctSubmissionMap.has(submission.flag_id)) {
          correctSubmissionMap.set(submission.flag_id, submission);
        }
      });

    const hintMap = new Map();

    teamHints.forEach((hint) => {
      hintMap.set(hint.flag_id, hint);
    });

    const teamProgressSolvedRows = teamProgress.filter(
      (item) => item.is_completed && item.is_correct
    );

    const teamProgressHintRows = teamProgress.filter(isHintProgress);

    const teamCorrectSubmittedFlagIds = new Set(
      teamSubmissions
        .filter((item) => item.is_correct)
        .map((item) => item.flag_id)
    );

    const effectiveSolvedFlagIds = new Set([
      ...teamSolves
        .filter((solve) => !solve.is_hint)
        .map((solve) => solve.flag_id),
      ...teamProgressSolvedRows.map((item) => item.flag_id),
      ...teamCorrectSubmittedFlagIds,
    ]);

    const effectiveHintFlagIds = new Set([
      ...teamSolves
        .filter((solve) => solve.is_hint)
        .map((solve) => solve.flag_id),
      ...teamHints.map((hint) => hint.flag_id),
      ...teamProgressHintRows.map((item) => item.flag_id),
    ]);

    const solvedAnswersMap = new Map();

    teamSolves
      .filter((solve) => !solve.is_hint)
      .forEach((solve) => {
        const flag = flagById.get(solve.flag_id);
        if (!flag) return;

        const round = roundById.get(solve.round_id || flag.round_id);
        const submission = correctSubmissionMap.get(solve.flag_id);
        const usedHint = effectiveHintFlagIds.has(solve.flag_id);

        solvedAnswersMap.set(solve.flag_id, {
          id: solve.id,
          flagId: solve.flag_id,
          roundId: solve.round_id || flag.round_id,
          roundNumber: round?.round_number || "-",
          roundTitle: round?.title || `Round ${round?.round_number || "-"}`,
          challengeOrder: flag.challenge_order || "-",
          flagTitle: flag.flag_title || "Challenge",
          questionType: flag.question_type || "flag",
          submittedAnswer: displaySubmittedAnswer(
            flag,
            submission?.submitted_flag || ""
          ),
          points: Number(solve.points || flag.points || 0),
          usedHint,
          hintText: usedHint
            ? hintMap.get(solve.flag_id)?.hint_text || getRevealedAnswer(flag)
            : "No hint used",
          solvedAt: solve.solved_at,
        });
      });

    teamProgressSolvedRows.forEach((item) => {
      if (solvedAnswersMap.has(item.flag_id)) return;

      const flag = flagById.get(item.flag_id);
      if (!flag) return;

      const round = roundById.get(item.round_id || flag.round_id);
      const submission = correctSubmissionMap.get(item.flag_id);
      const usedHint = effectiveHintFlagIds.has(item.flag_id);

      solvedAnswersMap.set(item.flag_id, {
        id: item.id,
        flagId: item.flag_id,
        roundId: item.round_id || flag.round_id,
        roundNumber: round?.round_number || "-",
        roundTitle: round?.title || `Round ${round?.round_number || "-"}`,
        challengeOrder: flag.challenge_order || "-",
        flagTitle: flag.flag_title || "Challenge",
        questionType: flag.question_type || "flag",
        submittedAnswer: displaySubmittedAnswer(
          flag,
          submission?.submitted_flag || item.last_submitted_answer || ""
        ),
        points: Number(flag.points || 0),
        usedHint,
        hintText: usedHint
          ? hintMap.get(item.flag_id)?.hint_text || getRevealedAnswer(flag)
          : "No hint used",
        solvedAt: item.completed_at,
      });
    });

    for (const flagId of teamCorrectSubmittedFlagIds) {
      if (solvedAnswersMap.has(flagId)) continue;

      const flag = flagById.get(flagId);
      const submission = correctSubmissionMap.get(flagId);

      if (!flag || !submission) continue;

      const round = roundById.get(flag.round_id);
      const usedHint = effectiveHintFlagIds.has(flagId);

      solvedAnswersMap.set(flagId, {
        id: submission.id,
        flagId,
        roundId: flag.round_id,
        roundNumber: round?.round_number || "-",
        roundTitle: round?.title || `Round ${round?.round_number || "-"}`,
        challengeOrder: flag.challenge_order || "-",
        flagTitle: flag.flag_title || "Challenge",
        questionType: flag.question_type || "flag",
        submittedAnswer: displaySubmittedAnswer(
          flag,
          submission.submitted_flag || ""
        ),
        points: Number(flag.points || submission.points_awarded || 0),
        usedHint,
        hintText: usedHint
          ? hintMap.get(flagId)?.hint_text || getRevealedAnswer(flag)
          : "No hint used",
        solvedAt: submission.submitted_at,
      });
    }

    const solvedAnswers = Array.from(solvedAnswersMap.values()).sort((a, b) => {
      if (!a.solvedAt) return 1;
      if (!b.solvedAt) return -1;

      return (
        new Date(toTime(a.solvedAt) || 0) -
        new Date(toTime(b.solvedAt) || 0)
      );
    });

    const usedHintsMap = new Map();

    Array.from(effectiveHintFlagIds).forEach((flagId) => {
      const flag = flagById.get(flagId);
      if (!flag) return;

      const round = roundById.get(flag.round_id);
      const hint = hintMap.get(flagId);
      const hintSolve = teamSolves.find(
        (solve) => solve.flag_id === flagId && solve.is_hint
      );
      const hintProgress = teamProgressHintRows.find(
        (item) => item.flag_id === flagId
      );

      usedHintsMap.set(flagId, {
        id: hint?.id || hintSolve?.id || hintProgress?.id || flagId,
        flagId,
        roundId: flag.round_id,
        roundNumber: round?.round_number || "-",
        roundTitle: round?.title || `Round ${round?.round_number || "-"}`,
        challengeOrder: flag.challenge_order || "-",
        flagTitle: flag.flag_title || "Challenge",
        questionType: flag.question_type || "flag",
        hintText: hint?.hint_text || getRevealedAnswer(flag),
        createdAt:
          hint?.created_at ||
          hintSolve?.solved_at ||
          hintProgress?.completed_at ||
          null,
      });
    });

    const usedHints = Array.from(usedHintsMap.values()).sort((a, b) => {
      if (!a.createdAt) return 1;
      if (!b.createdAt) return -1;

      return (
        new Date(toTime(a.createdAt) || 0) -
        new Date(toTime(b.createdAt) || 0)
      );
    });

    const historyItems = [
      ...solvedAnswers.map((item) => ({
        type: "solved",
        createdAt: item.solvedAt,
        ...item,
      })),
      ...usedHints.map((item) => ({
        type: "hint",
        createdAt: item.createdAt,
        ...item,
      })),
    ].sort((a, b) => {
      if (!a.createdAt) return 1;
      if (!b.createdAt) return -1;

      return (
        new Date(toTime(a.createdAt) || 0) -
        new Date(toTime(b.createdAt) || 0)
      );
    });

    const roundByNumber = new Map(
      safeRounds.map((round) => [Number(round.round_number), round])
    );

    const roundsProgress = selectedTeamStats.roundsProgress.map((item) => {
      const round = roundByNumber.get(Number(item.roundNumber));

      return {
        roundNumber: item.roundNumber,
        title: round?.title || `Round ${item.roundNumber}`,
        isActive: !!round?.is_active,
        solved: item.solved || 0,
        hints: item.hints || 0,
        completed: item.completed || 0,
        total: item.total || 0,
        score: item.score || 0,
        roundCompleted: item.total > 0 && item.completed === item.total,
      };
    });

    const rank =
      leaderboard.findIndex((item) => String(item.id) === String(teamId)) + 1;

    return jsonNoCache({
      success: true,
      settings: timerSettings,
      activeRound,
      roundsProgress,
      stats: {
        score: selectedTeamStats.score || 0,
        solved: selectedTeamStats.solved || 0,
        hints: selectedTeamStats.hints || 0,
        firstBlood: selectedTeamStats.firstBloods || 0,
        rank,
      },
      leaderboard,
      solvedAnswers,
      usedHints,
      historyItems,
      serverNow,
    });
  } catch (error) {
    return jsonNoCache({
      success: false,
      message: "Server error: " + error.message,
      serverNow: new Date().toISOString(),
    });
  }
}