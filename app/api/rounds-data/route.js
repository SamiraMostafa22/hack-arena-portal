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

function safeArray(value) {
  if (Array.isArray(value)) return value;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isMcqSubmission(value) {
  return String(value || "").startsWith("MCQ_");
}

function isHintProgress(item) {
  const answer = String(item?.last_submitted_answer || "").toUpperCase();
  return item?.is_completed && !item?.is_correct && answer === "HINT_REVEALED";
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

export async function GET() {
  try {
    const serverNow = new Date().toISOString();

    const loggedInTeam = await getLoggedInTeam();

    if (!loggedInTeam?.id) {
      return jsonNoCache(
        {
          success: false,
          message: "Unauthorized. Please login again.",
          serverNow,
        },
        { status: 401 }
      );
    }

    const teamId = loggedInTeam.id;

    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("competition_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (settingsError) {
      return jsonNoCache({
        success: false,
        message: "Settings error: " + settingsError.message,
        serverNow,
      });
    }

    const { data: rounds, error: roundsError } = await supabaseAdmin
      .from("rounds")
      .select("*")
      .eq("is_active", true)
      .lte("round_number", 3)
      .order("round_number", { ascending: true });

    if (roundsError) {
      return jsonNoCache({
        success: false,
        message: "Rounds error: " + roundsError.message,
        serverNow,
      });
    }

    const activeRounds = rounds || [];
    const activeRoundIds = activeRounds.map((round) => round.id);

    if (activeRoundIds.length === 0) {
      return jsonNoCache({
        success: true,
        gameOver: false,
        settings: settings || null,
        activeRound: null,
        rounds: [],
        message: "No active rounds now.",
        serverNow,
      });
    }

    const { data: flags, error: flagsError } = await supabaseAdmin
      .from("flags")
      .select(
        "id, round_id, flag_title, points, difficulty, estimated_time, is_active, challenge_order, question_type, options, input_fields"
      )
      .in("round_id", activeRoundIds)
      .eq("is_active", true)
      .order("challenge_order", { ascending: true });

    if (flagsError) {
      return jsonNoCache({
        success: false,
        message: "Flags error: " + flagsError.message,
        serverNow,
      });
    }

    const activeFlags = flags || [];
    const activeFlagIds = activeFlags.map((flag) => flag.id);
    const flagById = new Map(activeFlags.map((flag) => [flag.id, flag]));

    let submissions = [];
    let solves = [];
    let progress = [];
    let hints = [];

    if (activeFlagIds.length > 0) {
      const { data: submissionsData, error: submissionsError } =
        await supabaseAdmin
          .from("submissions")
          .select("flag_id, submitted_flag, is_correct, submitted_at")
          .eq("team_id", teamId)
          .in("flag_id", activeFlagIds);

      if (submissionsError) {
        return jsonNoCache({
          success: false,
          message: "Submissions error: " + submissionsError.message,
          serverNow,
        });
      }

      submissions = submissionsData || [];

      const { data: progressData, error: progressError } = await supabaseAdmin
        .from("team_flag_progress")
        .select(
          "flag_id, round_id, is_completed, is_correct, last_submitted_answer, completed_at"
        )
        .eq("team_id", teamId)
        .in("flag_id", activeFlagIds);

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

      const { data: hintsData, error: hintsError } = await supabaseAdmin
        .from("team_hints")
        .select("flag_id, created_at")
        .eq("team_id", teamId)
        .in("flag_id", activeFlagIds);

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
    }

    const { data: solvesData, error: solvesError } = await supabaseAdmin
      .from("solves")
      .select("flag_id, round_id, is_hint, solved_at")
      .eq("team_id", teamId)
      .in("round_id", activeRoundIds);

    if (solvesError) {
      return jsonNoCache({
        success: false,
        message: "Solves error: " + solvesError.message,
        serverNow,
      });
    }

    solves = solvesData || [];

    const submittedFlagIds = new Set(
      submissions.map((item) => item.flag_id).filter(Boolean)
    );

    const mcqAttemptedFlagIds = new Set(
      submissions
        .filter((item) => {
          const flag = flagById.get(item.flag_id);
          const questionType = String(
            flag?.question_type || "flag"
          ).toLowerCase();

          return questionType === "mcq" || isMcqSubmission(item.submitted_flag);
        })
        .map((item) => item.flag_id)
    );

    const correctSubmittedFlagIds = new Set(
      submissions.filter((item) => item.is_correct).map((item) => item.flag_id)
    );

    const progressCompletedFlagIds = new Set(
      progress.filter((item) => item.is_completed).map((item) => item.flag_id)
    );

    const progressSolvedFlagIds = new Set(
      progress
        .filter((item) => item.is_completed && item.is_correct)
        .map((item) => item.flag_id)
    );

    const progressHintFlagIds = new Set(
      progress.filter(isHintProgress).map((item) => item.flag_id)
    );

    const solveFlagIds = new Set(solves.map((solve) => solve.flag_id));

    const solvedFlagIds = new Set([
      ...solves
        .filter((solve) => !solve.is_hint)
        .map((solve) => solve.flag_id),
      ...progressSolvedFlagIds,
      ...correctSubmittedFlagIds,
    ]);

    const hintFlagIds = new Set([
      ...solves
        .filter((solve) => solve.is_hint)
        .map((solve) => solve.flag_id),
      ...hints.map((hint) => hint.flag_id),
      ...progressHintFlagIds,
    ]);

    const progressFlagIds = new Set([
      ...solveFlagIds,
      ...progressCompletedFlagIds,
      ...mcqAttemptedFlagIds,
      ...hintFlagIds,
      ...solvedFlagIds,
    ]);

    const roundsWithQuestions = activeRounds.map((round) => {
      const roundNumber = Number(round.round_number);

      const roundFlags = activeFlags
        .filter((flag) => flag.round_id === round.id)
        .sort(
          (a, b) =>
            Number(a.challenge_order || 999) -
            Number(b.challenge_order || 999)
        );

      const completedQuestions = roundFlags.filter((flag) =>
        progressFlagIds.has(flag.id)
      ).length;

      const roundCompleted =
        roundFlags.length > 0 && completedQuestions === roundFlags.length;

      const gameOver = roundCompleted && roundNumber === 3;

      const visibleQuestions = [];

      for (const flag of roundFlags) {
        visibleQuestions.push(flag);

        if (!progressFlagIds.has(flag.id)) {
          break;
        }
      }

      return {
        id: round.id,
        round_number: round.round_number,
        title: round.title,
        description: round.description,
        is_active: round.is_active,

        start_time: round.start_time || settings?.start_time || null,
        end_time: round.end_time || settings?.end_time || null,

        totalQuestions: roundFlags.length,
        completedQuestions,
        unlockedQuestions: visibleQuestions.length,

        roundCompleted,
        gameOver,
        nextRoundNumber: gameOver ? null : roundNumber + 1,

        questions: visibleQuestions.map((flag) => {
          const questionType = flag.question_type || "flag";

          const solved = solvedFlagIds.has(flag.id);
          const hintUsed = hintFlagIds.has(flag.id);
          const completed = progressFlagIds.has(flag.id);

          const attempted =
            submittedFlagIds.has(flag.id) ||
            mcqAttemptedFlagIds.has(flag.id) ||
            completed;

          return {
            id: flag.id,
            title: flag.flag_title,
            points: flag.points,
            difficulty: flag.difficulty,
            estimatedTime: flag.estimated_time,
            challengeOrder: flag.challenge_order,

            questionType,
            options: safeArray(flag.options),
            inputFields: safeArray(flag.input_fields),

            attempted,
            solved,
            hintUsed,
            completed,

            locked: false,
          };
        }),
      };
    });

    const anyGameOver = roundsWithQuestions.some((round) => round.gameOver);

    return jsonNoCache({
      success: true,
      gameOver: anyGameOver,
      settings: settings || null,
      activeRound: activeRounds[0] || null,
      rounds: roundsWithQuestions,
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