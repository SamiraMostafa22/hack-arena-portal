import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const SUCCESS_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=10, stale-while-revalidate=60",
};

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

function jsonSuccess(data) {
  return Response.json(data, {
    headers: SUCCESS_CACHE_HEADERS,
  });
}

function jsonError(data) {
  return Response.json(data, {
    headers: NO_CACHE_HEADERS,
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

function getTeamName(team) {
  return (
    team.team_name ||
    team.name ||
    team.username ||
    team.title ||
    `Team ${team.id}`
  );
}

function isHintProgress(item) {
  const answer = String(item?.last_submitted_answer || "").toUpperCase();
  return item?.is_completed && !item?.is_correct && answer === "HINT_REVEALED";
}

export async function GET() {
  try {
    const serverNow = new Date().toISOString();

    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("competition_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (settingsError) {
      return jsonError({
        success: false,
        message: "Settings error: " + settingsError.message,
        serverNow,
      });
    }

    const { data: teams, error: teamsError } = await supabaseAdmin
      .from("teams")
      .select("*")
      .order("created_at", { ascending: true });

    if (teamsError) {
      return jsonError({
        success: false,
        message: "Teams error: " + teamsError.message,
        serverNow,
      });
    }

    const { data: rounds, error: roundsError } = await supabaseAdmin
      .from("rounds")
      .select("*")
      .lte("round_number", 3)
      .order("round_number", { ascending: true });

    if (roundsError) {
      return jsonError({
        success: false,
        message: "Rounds error: " + roundsError.message,
        serverNow,
      });
    }

    const allRounds = rounds || [];
    const roundIds = allRounds.map((round) => round.id);
    const activeRound = allRounds.find((round) => round.is_active) || null;

    const timerSettings = {
      ...(settings || {}),
      start_time: activeRound?.start_time || settings?.start_time || null,
      end_time: activeRound?.end_time || settings?.end_time || null,
    };

    let flags = [];

    if (roundIds.length > 0) {
      const { data: flagsData, error: flagsError } = await supabaseAdmin
        .from("flags")
        .select("*")
        .in("round_id", roundIds)
        .eq("is_active", true)
        .order("challenge_order", { ascending: true });

      if (flagsError) {
        return jsonError({
          success: false,
          message: "Flags error: " + flagsError.message,
          serverNow,
        });
      }

      flags = flagsData || [];
    }

    const flagIds = flags.map((flag) => flag.id);

    let solves = [];
    let submissions = [];
    let teamHints = [];
    let progress = [];

    if (roundIds.length > 0) {
      const { data: solvesData, error: solvesError } = await supabaseAdmin
        .from("solves")
        .select("*")
        .in("round_id", roundIds);

      if (solvesError) {
        return jsonError({
          success: false,
          message: "Solves error: " + solvesError.message,
          serverNow,
        });
      }

      solves = solvesData || [];
    }

    if (flagIds.length > 0) {
      const { data: submissionsData, error: submissionsError } =
        await supabaseAdmin.from("submissions").select("*").in("flag_id", flagIds);

      if (submissionsError) {
        return jsonError({
          success: false,
          message: "Submissions error: " + submissionsError.message,
          serverNow,
        });
      }

      submissions = submissionsData || [];

      const { data: hintsData, error: hintsError } = await supabaseAdmin
        .from("team_hints")
        .select("*")
        .in("flag_id", flagIds);

      if (hintsError) {
        return jsonError({
          success: false,
          message:
            "Hints error: " +
            hintsError.message +
            ". Make sure team_hints table exists.",
          serverNow,
        });
      }

      teamHints = hintsData || [];

      const { data: progressData, error: progressError } = await supabaseAdmin
        .from("team_flag_progress")
        .select("*")
        .in("flag_id", flagIds);

      if (progressError) {
        return jsonError({
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

    const flagById = new Map(flags.map((flag) => [flag.id, flag]));
    const roundById = new Map(allRounds.map((round) => [round.id, round]));

    const totalsByRoundNumber = {
      1: 0,
      2: 0,
      3: 0,
    };

    for (const flag of flags) {
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

        // Kept for UI compatibility only.
        // It does NOT affect ranking anymore.
        firstBloods: 0,

        lastSubmit: null,
        lastScoreTime: null,

        // Ranking time:
        // Sum of every solved question time from its round start.
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

    function addNormalSolve({ teamId, flagId, roundId, points, solvedAt }) {
      const team = teamStats.get(teamId);
      const flag = flagById.get(flagId);
      const round = roundById.get(roundId || flag?.round_id);

      if (!team || !flag || !round) return;

      const uniqueKey = `${teamId}-${flagId}`;
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

    function addHint({ teamId, flagId, createdAt }) {
      const team = teamStats.get(teamId);
      const flag = flagById.get(flagId);

      if (!team || !flag) return;

      const round = roundById.get(flag.round_id);
      const roundNumber = Number(round?.round_number);
      const uniqueKey = `${teamId}-${flagId}`;

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

    function addCompleted({ teamId, flagId, completedAt }) {
      const team = teamStats.get(teamId);
      const flag = flagById.get(flagId);

      if (!team || !flag) return;

      const round = roundById.get(flag.round_id);
      const roundNumber = Number(round?.round_number);
      const uniqueKey = `${teamId}-${flagId}`;

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
      const solveTime =
        solve.created_at || solve.solved_at || solve.inserted_at || null;

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

    for (const hint of teamHints || []) {
      addHint({
        teamId: hint.team_id,
        flagId: hint.flag_id,
        createdAt: hint.created_at || hint.inserted_at,
      });
    }

    for (const item of progress || []) {
      if (!item.is_completed) continue;

      const completedTime = item.completed_at || item.created_at;

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
      const team = teamStats.get(submission.team_id);

      if (!team) continue;

      const submitTime = toTime(
        submission.created_at ||
          submission.submitted_at ||
          submission.inserted_at
      );

      if (isAfter(submitTime, team.lastSubmit)) {
        team.lastSubmit = submitTime;
      }
    }

    const leaderboard = Array.from(teamStats.values()).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.solved !== a.solved) return b.solved - a.solved;

      // Ranking for ALL rounds:
      // 1) Higher score
      // 2) More solved questions
      // 3) Lower total solve time
      // 4) Team name
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

    return jsonSuccess({
      success: true,
      settings: timerSettings,
      activeRound,
      rounds: allRounds,
      leaderboard,
      serverNow,
    });
  } catch (error) {
    return jsonError({
      success: false,
      message: "Server error: " + error.message,
      serverNow: new Date().toISOString(),
    });
  }
}