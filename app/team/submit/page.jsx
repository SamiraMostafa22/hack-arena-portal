"use client";

import Header from "../../components/Header";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

function shuffleOptions(options) {
  const list = Array.isArray(options) ? [...options] : [];

  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }

  return list;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTimeMs(value) {
  if (!value) return NaN;

  if (value instanceof Date) return value.getTime();

  const text = String(value).trim();

  if (!text) return NaN;

  const hasTimezone = /z$/i.test(text) || /[+-]\d{2}:?\d{2}$/.test(text);

  const isoText = text.includes("T") ? text : text.replace(" ", "T");
  const normalized = hasTimezone ? isoText : `${isoText}Z`;

  return new Date(normalized).getTime();
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}:${String(seconds).padStart(2, "0")}`;
}

function isNotStartedMessage(message) {
  return String(message || "").toLowerCase().includes("not started");
}

function SubmitRoundTimer({ startTime, endTime, onEnd, serverOffsetMs = 0 }) {
  const [timer, setTimer] = useState({
    label: "Timer",
    value: "--:--:--",
    phase: "idle",
  });

  const endedCalledRef = useRef(false);
  const onEndRef = useRef(onEnd);
  const serverOffsetRef = useRef(0);

  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  useEffect(() => {
    serverOffsetRef.current = Number.isFinite(serverOffsetMs)
      ? serverOffsetMs
      : 0;
  }, [serverOffsetMs]);

  useEffect(() => {
    endedCalledRef.current = false;

    function updateTimer() {
      if (!startTime || !endTime) {
        setTimer({
          label: "Timer",
          value: "--:--:--",
          phase: "idle",
        });
        return;
      }

      const now = Date.now() + serverOffsetRef.current;
      const start = getTimeMs(startTime);
      const end = getTimeMs(endTime);

      if (Number.isNaN(start) || Number.isNaN(end)) {
        setTimer({
          label: "Timer",
          value: "--:--:--",
          phase: "idle",
        });
        return;
      }

      if (now < start) {
        setTimer({
          label: "Round starts in",
          value: formatDuration(start - now),
          phase: "starting",
        });
        return;
      }

      if (now < end) {
        setTimer({
          label: "Time left",
          value: formatDuration(end - now),
          phase: "running",
        });
        return;
      }

      setTimer({
        label: "Time is over",
        value: "00:00:00",
        phase: "ended",
      });

      if (!endedCalledRef.current) {
        endedCalledRef.current = true;
        onEndRef.current?.();
      }
    }

    updateTimer();

    const interval = setInterval(updateTimer, 500);

    return () => clearInterval(interval);
  }, [startTime, endTime]);

  return (
    <div
      className={`mt-5 rounded-2xl border px-5 py-4 text-center ${
        timer.phase === "ended"
          ? "border-red-500 bg-red-950/50 text-red-200"
          : timer.phase === "starting"
          ? "border-yellow-500 bg-yellow-950/40 text-yellow-200"
          : "border-[#ff4b00]/50 bg-black/70 text-orange-200"
      }`}
    >
      <p className="cyber-title text-xs uppercase tracking-[0.25em]">
        {timer.label}
      </p>

      <p className="mt-2 font-mono text-4xl font-black leading-none">
        {timer.value}
      </p>
    </div>
  );
}

export default function SubmitFlagPage() {
  const router = useRouter();

  const [team, setTeam] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [selectedRoundIndex, setSelectedRoundIndex] = useState(0);
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState(0);

  const selectedRoundIndexRef = useRef(0);
  const selectedQuestionIndexRef = useRef(0);

  const [flag, setFlag] = useState("");
  const [answerValues, setAnswerValues] = useState({});
  const [message, setMessage] = useState("");
  const [revealedAnswer, setRevealedAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [hintLoading, setHintLoading] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [selectedRoundEnded, setSelectedRoundEnded] = useState(false);
  const [roundTimerSettings, setRoundTimerSettings] = useState(null);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);

  const [showSolveAnimation, setShowSolveAnimation] = useState(false);
  const [solveAnimationData, setSolveAnimationData] = useState({
    title: "",
    points: 0,
    firstBlood: false,
  });

  function syncServerOffset(serverNow, requestStartedAt, responseReceivedAt) {
    const serverNowMs = getTimeMs(serverNow);

    if (Number.isNaN(serverNowMs)) return;

    const latencyAdjustedClientNow =
      requestStartedAt + (responseReceivedAt - requestStartedAt) / 2;

    setServerOffsetMs(serverNowMs - latencyAdjustedClientNow);
  }

  function updateSelectedRoundIndex(index) {
    selectedRoundIndexRef.current = index;
    setSelectedRoundIndex(index);
  }

  function updateSelectedQuestionIndex(index) {
    selectedQuestionIndexRef.current = index;
    setSelectedQuestionIndex(index);
  }

  const selectedRound = rounds[selectedRoundIndex];
  const questions = selectedRound?.questions || [];
  const selectedQuestion = questions[selectedQuestionIndex];

  const isRoundThree = Number(selectedRound?.round_number) === 3;

  const timerStartTime =
    selectedRound?.start_time || roundTimerSettings?.start_time || null;

  const timerEndTime =
    selectedRound?.end_time || roundTimerSettings?.end_time || null;

  const selectedRoundCompleted = !!selectedRound?.roundCompleted;
  const selectedRoundGameOver = !!selectedRound?.gameOver || gameOver;

  const isMcq = selectedQuestion?.questionType === "mcq";
  const isMultiInput = selectedQuestion?.questionType === "multi_input";

  const mcqAlreadyAttempted =
    isMcq &&
    selectedQuestion?.attempted &&
    !selectedQuestion?.solved &&
    !selectedQuestion?.hintUsed;

  const challengeClosed =
    selectedRoundEnded ||
    selectedQuestion?.solved ||
    selectedQuestion?.hintUsed ||
    mcqAlreadyAttempted ||
    selectedRoundCompleted ||
    selectedRoundGameOver;

  const shuffledOptions = useMemo(() => {
    if (!isMcq) return [];
    return shuffleOptions(selectedQuestion?.options || []);
  }, [isMcq, selectedQuestion?.id]);

  function getFlagCacheKey(teamId, questionId) {
    if (!teamId || !questionId) return null;
    return `hack-arena-flag-input-${teamId}-${questionId}`;
  }

  function getAnswerValuesCacheKey(teamId, questionId) {
    if (!teamId || !questionId) return null;
    return `hack-arena-answer-values-${teamId}-${questionId}`;
  }

  function saveFlagToCache(value) {
    const key = getFlagCacheKey(team?.id, selectedQuestion?.id);
    if (!key) return;

    localStorage.setItem(key, value);
  }

  function saveAnswerValuesToCache(values) {
    const key = getAnswerValuesCacheKey(team?.id, selectedQuestion?.id);
    if (!key) return;

    localStorage.setItem(key, JSON.stringify(values || {}));
  }

  function clearFlagCache() {
    const key = getFlagCacheKey(team?.id, selectedQuestion?.id);
    if (!key) return;

    localStorage.removeItem(key);
  }

  function clearAnswerValuesCache() {
    const key = getAnswerValuesCacheKey(team?.id, selectedQuestion?.id);
    if (!key) return;

    localStorage.removeItem(key);
  }

  function clearCurrentCaches() {
    clearFlagCache();
    clearAnswerValuesCache();
  }

  function triggerSolveAnimation(title, points, firstBlood) {
    setSolveAnimationData({
      title: title || "Challenge Solved",
      points: points || 0,
      firstBlood: !!firstBlood,
    });

    setShowSolveAnimation(true);

    setTimeout(() => {
      setShowSolveAnimation(false);
    }, 2300);
  }

  async function fetchTimerSettings() {
    try {
      const requestStartedAt = Date.now();

      const res = await fetch(`/api/global-data?t=${Date.now()}`, {
        cache: "no-store",
      });

      const data = await res.json();
      const responseReceivedAt = Date.now();

      if (data.success) {
        syncServerOffset(data.serverNow, requestStartedAt, responseReceivedAt);
        setRoundTimerSettings(data.settings || null);
      }
    } catch (error) {
      console.warn("Timer settings fetch skipped:", error.message);
    }
  }

  async function fetchRoundsData() {
    const saved = localStorage.getItem("team");
    const savedTeam = saved ? JSON.parse(saved) : null;

    if (!savedTeam?.id) {
      router.push("/login");
      return {
        rounds: [],
        gameOver: false,
      };
    }

    const requestStartedAt = Date.now();

    const res = await fetch(`/api/rounds-data?t=${Date.now()}`, {
      cache: "no-store",
      credentials: "include",
    });

    const responseReceivedAt = Date.now();

    if (res.status === 401) {
      localStorage.removeItem("team");
      router.push("/login");

      return {
        rounds: [],
        gameOver: false,
      };
    }

    if (!res.ok) {
      console.error("Rounds API HTTP error:", res.status);
      return {
        rounds: [],
        gameOver: false,
      };
    }

    const data = await res.json();

    if (data.serverNow) {
      syncServerOffset(data.serverNow, requestStartedAt, responseReceivedAt);
    }

    if (data.settings) {
      setRoundTimerSettings(data.settings);
    }

    if (!data.success) {
      console.error("Rounds API error:", data.message);
      return {
        rounds: [],
        gameOver: false,
      };
    }

    return {
      rounds: data.rounds || [],
      gameOver: !!data.gameOver,
    };
  }

  function applyRoundsState(
    loadedRounds,
    targetRoundId = null,
    targetIndex = null
  ) {
    setRounds(loadedRounds);

    const maxRoundIndex = Math.max(loadedRounds.length - 1, 0);

    let safeRoundIndex = selectedRoundIndexRef.current;

    if (targetRoundId) {
      const foundIndex = loadedRounds.findIndex(
        (round) => round.id === targetRoundId
      );

      safeRoundIndex = foundIndex >= 0 ? foundIndex : 0;
    }

    safeRoundIndex = Math.min(safeRoundIndex, maxRoundIndex);

    const currentRound = loadedRounds[safeRoundIndex] || loadedRounds[0];

    const maxQuestionIndex = Math.max(
      (currentRound?.questions || []).length - 1,
      0
    );

    let safeQuestionIndex = selectedQuestionIndexRef.current;

    if (targetIndex !== null) {
      safeQuestionIndex = targetIndex;
    }

    safeQuestionIndex = Math.min(safeQuestionIndex, maxQuestionIndex);

    updateSelectedRoundIndex(safeRoundIndex);
    updateSelectedQuestionIndex(safeQuestionIndex);
  }

  async function loadRounds(targetIndex = null, targetRoundId = null) {
    try {
      const result = await fetchRoundsData();
      const loadedRounds = result.rounds || [];

      setGameOver(!!result.gameOver);

      if (loadedRounds.length === 0) {
        setRounds([]);
        return [];
      }

      applyRoundsState(loadedRounds, targetRoundId, targetIndex);
      return loadedRounds;
    } catch (error) {
      console.warn("Rounds fetch skipped during reload:", error.message);
      return [];
    }
  }

  async function moveToNextQuestionAfterUnlock() {
    const currentRoundId = selectedRound?.id;
    const currentQuestionId = selectedQuestion?.id;

    let latestRounds = [];

    function clearFeedback() {
      setMessage("");
      setRevealedAnswer("");
    }

    for (let attempt = 0; attempt < 6; attempt++) {
      const result = await fetchRoundsData();
      latestRounds = result.rounds || [];
      setGameOver(!!result.gameOver);

      const foundRoundIndex = latestRounds.findIndex(
        (round) => round.id === currentRoundId
      );

      const roundIndex = foundRoundIndex >= 0 ? foundRoundIndex : 0;
      const round = latestRounds[roundIndex] || latestRounds[0];
      const latestQuestions = round?.questions || [];

      if (round?.roundCompleted || round?.gameOver || result.gameOver) {
        setRounds(latestRounds);
        updateSelectedRoundIndex(roundIndex);
        updateSelectedQuestionIndex(Math.max(latestQuestions.length - 1, 0));
        clearFeedback();
        return;
      }

      const currentIndexInLatest = latestQuestions.findIndex(
        (question) => question.id === currentQuestionId
      );

      const nextIndex =
        currentIndexInLatest >= 0
          ? currentIndexInLatest + 1
          : selectedQuestionIndexRef.current + 1;

      if (latestQuestions.length > nextIndex) {
        setRounds(latestRounds);
        updateSelectedRoundIndex(roundIndex);
        updateSelectedQuestionIndex(nextIndex);
        clearFeedback();
        return;
      }

      if (attempt < 5) {
        await wait(350);
      }
    }

    const foundFallbackRoundIndex = latestRounds.findIndex(
      (round) => round.id === currentRoundId
    );

    const fallbackRoundIndex =
      foundFallbackRoundIndex >= 0 ? foundFallbackRoundIndex : 0;

    const fallbackRound = latestRounds[fallbackRoundIndex] || latestRounds[0];
    const fallbackQuestions = fallbackRound?.questions || [];

    const fallbackIndex = Math.min(
      selectedQuestionIndexRef.current + 1,
      Math.max(fallbackQuestions.length - 1, 0)
    );

    setRounds(latestRounds);
    updateSelectedRoundIndex(fallbackRoundIndex);
    updateSelectedQuestionIndex(fallbackIndex);
    clearFeedback();
  }

  useEffect(() => {
    const saved = localStorage.getItem("team");

    if (!saved) {
      router.push("/login");
      return;
    }

    setTeam(JSON.parse(saved));

    loadRounds();
    fetchTimerSettings();

    const interval = setInterval(() => {
      loadRounds();
    }, 10000);

    const timerInterval = setInterval(() => {
      fetchTimerSettings();
    }, 1000);

    return () => {
      clearInterval(interval);
      clearInterval(timerInterval);
    };
  }, [router]);

  useEffect(() => {
    setSelectedRoundEnded(false);
  }, [selectedRound?.id, timerStartTime, timerEndTime]);

  useEffect(() => {
    if (!team?.id || !selectedQuestion?.id) return;

    if (selectedQuestion?.questionType === "multi_input") {
      const key = getAnswerValuesCacheKey(team.id, selectedQuestion.id);
      const cached = localStorage.getItem(key);

      try {
        setAnswerValues(cached ? JSON.parse(cached) : {});
      } catch {
        setAnswerValues({});
      }

      setFlag("");
      setMessage("");
      setRevealedAnswer("");
      return;
    }

    const key = getFlagCacheKey(team.id, selectedQuestion.id);
    const cachedFlag = localStorage.getItem(key);

    setFlag(cachedFlag || "");
    setAnswerValues({});
    setMessage("");
    setRevealedAnswer("");
  }, [team?.id, selectedQuestion?.id, selectedQuestion?.questionType]);

  async function handleSubmit(e) {
    e.preventDefault();

    if (selectedRoundCompleted || selectedRoundGameOver) {
      setMessage(
        selectedRoundGameOver
          ? "Game Over. You completed all rounds."
          : "This round is already completed."
      );
      return;
    }

    if (selectedRoundEnded) {
      setMessage("Time is over. Submissions are closed.");
      return;
    }

    if (challengeClosed) {
      setMessage(
        selectedRoundEnded
          ? "Time is over. Submissions are closed."
          : mcqAlreadyAttempted
          ? "You already answered this MCQ. Only one attempt is allowed."
          : selectedQuestion?.hintUsed
          ? "This challenge was revealed by hint. No points awarded."
          : "This challenge is already solved."
      );
      return;
    }

    if (isMultiInput) {
      const fields = selectedQuestion?.inputFields || [];

      const hasEmptyField = fields.some(
        (field) => !String(answerValues[field.id] || "").trim()
      );

      if (hasEmptyField) {
        setMessage("Please fill all required values.");
        return;
      }
    } else if (!flag.trim()) {
      setMessage(isMcq ? "Please choose an answer." : "Please enter a flag.");
      return;
    }

    if (!team?.id) {
      setMessage("Team data not found. Please login again.");
      router.push("/login");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const currentTitle = selectedQuestion?.title || "Challenge Solved";
      const requestStartedAt = Date.now();

      const res = await fetch("/api/submit-flag", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          isMcq
            ? {
                flagId: selectedQuestion.id,
                selectedOption: flag,
              }
            : isMultiInput
            ? {
                flagId: selectedQuestion.id,
                answerValues,
              }
            : {
                flagId: selectedQuestion.id,
                submittedFlag: flag,
              }
        ),
      });

      const data = await res.json();
      const responseReceivedAt = Date.now();

      if (res.status === 401) {
        localStorage.removeItem("team");
        setMessage("Unauthorized. Please login again.");
        router.push("/login");
        return;
      }

      if (data.serverNow) {
        syncServerOffset(data.serverNow, requestStartedAt, responseReceivedAt);
      }

      if (data.isExpired) {
        const serverMessage =
          data.message || "Time is over. Submissions are closed.";

        if (!isNotStartedMessage(serverMessage)) {
          setSelectedRoundEnded(true);
        }

        setMessage(serverMessage);
        await loadRounds();
        return;
      }

      if (data.success) {
        clearCurrentCaches();
        setFlag("");
        setAnswerValues({});
        setMessage("");
        setRevealedAnswer("");

        triggerSolveAnimation(
          currentTitle,
          data.points || data.pointsAwarded || selectedQuestion?.points || 0,
          data.firstBlood
        );

        await moveToNextQuestionAfterUnlock();
      } else if (data.mcqAttempted || data.moveToNext || data.isCompleted) {
        clearCurrentCaches();
        setFlag("");
        setAnswerValues({});
        setMessage("");
        setRevealedAnswer("");

        await moveToNextQuestionAfterUnlock();
      } else {
        setMessage(data.message || "Submission completed.");

        if (isMultiInput) {
          saveAnswerValuesToCache(answerValues);
        } else {
          saveFlagToCache(flag);
        }

        await loadRounds();
      }
    } catch (error) {
      console.error("Submit answer error:", error);
      setMessage("Could not submit answer. Please try again.");

      if (isMultiInput) {
        saveAnswerValuesToCache(answerValues);
      } else {
        saveFlagToCache(flag);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleHint() {
    if (!team?.id || !selectedQuestion?.id) {
      setMessage("No challenge selected.");
      return;
    }

    if (isRoundThree) {
      setMessage("Hints are disabled in Round 3.");
      return;
    }

    if (selectedRoundCompleted || selectedRoundGameOver) {
      setMessage(
        selectedRoundGameOver
          ? "Game Over. You completed all rounds."
          : "This round is already completed."
      );
      return;
    }

    if (selectedRoundEnded) {
      setMessage("Time is over. Hints are closed.");
      return;
    }

    const confirmHint = window.confirm(
      "Using a hint will reveal the correct answer and give 0 points. Continue?"
    );

    if (!confirmHint) return;

    setHintLoading(true);
    setMessage("");
    setRevealedAnswer("");

    try {
      const requestStartedAt = Date.now();

      const res = await fetch("/api/use-hint", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          flagId: selectedQuestion.id,
        }),
      });

      const data = await res.json();
      const responseReceivedAt = Date.now();

      if (res.status === 401) {
        localStorage.removeItem("team");
        setMessage("Unauthorized. Please login again.");
        router.push("/login");
        return;
      }

      if (data.serverNow) {
        syncServerOffset(data.serverNow, requestStartedAt, responseReceivedAt);
      }

      if (data.isExpired) {
        const serverMessage = data.message || "Time is over. Hints are closed.";

        if (!isNotStartedMessage(serverMessage)) {
          setSelectedRoundEnded(true);
        }

        setMessage(serverMessage);
        await loadRounds();
        return;
      }

      setMessage(data.message || "Hint used.");

      if (
        data.success &&
        (data.revealedAnswer || data.revealedFlag || data.hint)
      ) {
        clearCurrentCaches();
        setFlag("");
        setAnswerValues({});
        setRevealedAnswer(
          data.revealedAnswer || data.revealedFlag || data.hint
        );

        await loadRounds();
      }
    } catch (error) {
      console.error("Hint error:", error);
      setMessage("Could not use hint. Please try again.");
    } finally {
      setHintLoading(false);
    }
  }

  function goNextQuestion() {
    if (selectedQuestionIndex < questions.length - 1) {
      updateSelectedQuestionIndex(selectedQuestionIndex + 1);
      setMessage("");
      setRevealedAnswer("");
    }
  }

  function goPreviousQuestion() {
    if (selectedQuestionIndex > 0) {
      updateSelectedQuestionIndex(selectedQuestionIndex - 1);
      setMessage("");
      setRevealedAnswer("");
    }
  }

  function getQuestionTypeLabel(question) {
    if (question?.questionType === "mcq") return "MCQ";
    if (question?.questionType === "multi_input") return "Multi Input";
    return "Flag";
  }

  function goDashboard() {
    router.push("/team/dashboard");
  }

  function goLeaderboard() {
    router.push("/leaderboard");
  }

  if (!team) {
    return (
      <main className="min-h-screen bg-black p-8 text-white">Loading...</main>
    );
  }

  return (
    <main className="cyber-noise min-h-screen bg-[#050505] text-white">
      <Header />

      <section className="cyber-grid-bg relative min-h-[calc(100vh-132px)] overflow-hidden px-6 py-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#ff4b0033,transparent_35%),radial-gradient(circle_at_bottom,#9b1f0033,transparent_40%)]" />

        <div className="relative mx-auto grid max-w-7xl gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="cyber-card rounded-3xl p-8">
            <div className="mb-8">
              <p className="cyber-title text-sm text-[#ff4b00]">
                Open Challenges
              </p>

              <h1 className="cyber-title mt-3 text-4xl font-black">
                Current <span className="text-[#ff4b00]">Round</span>
              </h1>

              <p className="mt-3 text-gray-400">
                Team:{" "}
                <span className="font-bold text-white">{team.team_name}</span>
              </p>

              {selectedRound && (
                <SubmitRoundTimer
                  startTime={timerStartTime}
                  endTime={timerEndTime}
                  serverOffsetMs={serverOffsetMs}
                  onEnd={() => {
                    setSelectedRoundEnded(true);
                    setMessage("Time is over. Submissions are closed.");
                  }}
                />
              )}
            </div>

            {rounds.length === 0 ? (
              <div className="rounded-2xl border border-[#ff4b00]/40 bg-black/70 p-8 text-center">
                <p className="cyber-title text-2xl text-[#ff4b00]">
                  No Open Round
                </p>

                <p className="mt-3 text-gray-400">
                  Please wait until the organizer opens the next round.
                </p>
              </div>
            ) : selectedRoundGameOver ? (
              <div className="rounded-[2rem] border border-green-500/50 bg-green-950/30 p-10 text-center shadow-[0_0_35px_rgba(34,197,94,0.25)]">
                <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full border border-green-400 bg-green-950 text-5xl shadow-[0_0_35px_rgba(34,197,94,0.35)]">
                  🏁
                </div>

                <p className="cyber-title text-sm uppercase tracking-[0.35em] text-green-300">
                  Game Over
                </p>

                <h2 className="cyber-title mt-4 text-5xl font-black text-white">
                  You Completed All Rounds!
                </h2>

                <p className="mx-auto mt-5 max-w-xl text-lg leading-8 text-green-100/80">
                  Excellent work. Your final score is saved. You can review your
                  solved answers, hints, and ranking from the dashboards.
                </p>

                <div className="mt-8 flex flex-wrap justify-center gap-4">
                  <button
                    type="button"
                    onClick={goDashboard}
                    className="rounded-2xl bg-green-400 px-7 py-4 font-black text-black transition hover:scale-[1.04]"
                  >
                    View Team Dashboard
                  </button>

                  <button
                    type="button"
                    onClick={goLeaderboard}
                    className="rounded-2xl border border-green-400/60 bg-black px-7 py-4 font-black text-green-200 transition hover:scale-[1.04]"
                  >
                    View Global Dashboard
                  </button>
                </div>
              </div>
            ) : selectedRoundCompleted ? (
              <div className="rounded-[2rem] border border-[#ff4b00]/50 bg-black/70 p-10 text-center shadow-[0_0_35px_rgba(255,75,0,0.2)]">
                <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full border border-[#ff4b00] bg-[#ff4b00]/15 text-5xl shadow-[0_0_35px_rgba(255,75,0,0.35)]">
                  🎉
                </div>

                <p className="cyber-title text-sm uppercase tracking-[0.35em] text-[#ff7a1a]">
                  Round Completed
                </p>

                <h2 className="cyber-title mt-4 text-5xl font-black text-white">
                  Round {selectedRound?.round_number} Finished!
                </h2>

                <p className="mx-auto mt-5 max-w-xl text-lg leading-8 text-gray-300">
                  Great job. You finished all available challenges in this
                  round. Please wait for the organizer to open the next round.
                </p>

                <div className="mt-8 flex flex-wrap justify-center gap-4">
                  <button
                    type="button"
                    onClick={goDashboard}
                    className="cyber-button rounded-2xl px-7 py-4 font-black"
                  >
                    Team Dashboard
                  </button>

                  <button
                    type="button"
                    onClick={goLeaderboard}
                    className="rounded-2xl border border-[#ff4b00]/60 bg-black px-7 py-4 font-black text-orange-200 transition hover:scale-[1.04]"
                  >
                    Global Dashboard
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-6 flex flex-wrap gap-3">
                  {rounds.map((round, index) => (
                    <button
                      key={round.id}
                      type="button"
                      onClick={() => {
                        updateSelectedRoundIndex(index);
                        updateSelectedQuestionIndex(0);
                        setMessage("");
                        setRevealedAnswer("");
                      }}
                      className={`rounded-xl px-5 py-3 font-black transition hover:scale-[1.03] ${
                        index === selectedRoundIndex
                          ? "bg-[#ff4b00] text-black shadow-[0_0_18px_rgba(255,75,0,0.45)]"
                          : "border border-[#ff4b00]/50 bg-black text-orange-200"
                      }`}
                    >
                      Round {round.round_number}
                    </button>
                  ))}
                </div>

                <div className="rounded-3xl border border-[#ff4b00]/40 bg-black/70 p-6">
                  <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-sm text-[#ff7a1a]">
                        Round {selectedRound.round_number}
                      </p>

                      <h2 className="mt-1 text-3xl font-black">
                        {selectedRound.title}
                      </h2>
                    </div>

                    <span
                      className={`rounded-full border px-5 py-2 text-sm font-black uppercase tracking-[0.2em] ${
                        selectedRoundEnded
                          ? "border-red-500 bg-red-950 text-red-200"
                          : "border-green-500 bg-green-950 text-green-300"
                      }`}
                    >
                      {selectedRoundEnded ? "Closed" : "Open"}
                    </span>
                  </div>

                  {questions.length === 0 ? (
                    <p className="text-gray-400">
                      No challenges available in this round.
                    </p>
                  ) : (
                    <>
                      <div className="mb-6">
                        <p className="text-sm font-bold text-[#ff7a1a]">
                          Challenge {selectedQuestionIndex + 1} of{" "}
                          {selectedRound.totalQuestions || questions.length}
                        </p>

                        <div className="mt-3 rounded-2xl border border-[#ff4b00]/40 bg-black/70 p-5">
                          <p className="cyber-title text-xs text-[#ff4b00]">
                            Challenge Question
                          </p>

                          <h3 className="mt-3 text-3xl font-black leading-snug text-white">
                            {selectedQuestion?.title}
                          </h3>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-3">
                          <span className="rounded-full border border-[#ff4b00]/40 bg-[#ff4b00]/10 px-4 py-2 text-sm font-bold text-orange-200">
                            {selectedQuestion?.hintUsed
                              ? "0 pts"
                              : `${selectedQuestion?.points} pts`}
                          </span>

                          <span className="rounded-full border border-[#ff4b00]/40 bg-black px-4 py-2 text-sm font-bold text-gray-300">
                            Type: {getQuestionTypeLabel(selectedQuestion)}
                          </span>

                          <span className="rounded-full border border-[#ff4b00]/40 bg-black px-4 py-2 text-sm font-bold text-gray-300">
                            Difficulty:{" "}
                            {selectedQuestion?.difficulty || "N/A"}
                          </span>

                          {isRoundThree && (
                            <span className="rounded-full border border-red-500 bg-red-950 px-4 py-2 text-sm font-bold text-red-200">
                              Round 3 - No Hints
                            </span>
                          )}

                          {selectedRoundEnded ? (
                            <span className="rounded-full border border-red-500 bg-red-950 px-4 py-2 text-sm font-bold text-red-200">
                              Time Over
                            </span>
                          ) : selectedQuestion?.hintUsed ? (
                            <span className="rounded-full border border-yellow-500 bg-yellow-950 px-4 py-2 text-sm font-bold text-yellow-200">
                              Hint Used - 0 pts
                            </span>
                          ) : selectedQuestion?.solved ? (
                            <span className="rounded-full border border-green-500 bg-green-950 px-4 py-2 text-sm font-bold text-green-300">
                              Solved
                            </span>
                          ) : mcqAlreadyAttempted ? (
                            <span className="rounded-full border border-red-500 bg-red-950 px-4 py-2 text-sm font-bold text-red-200">
                              MCQ Submitted - 0 pts
                            </span>
                          ) : (
                            <span className="rounded-full border border-[#ff4b00]/50 bg-[#ff4b00]/10 px-4 py-2 text-sm font-bold text-orange-200">
                              Current Challenge
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="mt-6">
                        <p className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-gray-400">
                          Select Challenge
                        </p>

                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          {questions.map((q, index) => {
                            const qAttempted =
                              q.questionType === "mcq" &&
                              q.attempted &&
                              !q.solved &&
                              !q.hintUsed;

                            return (
                              <button
                                key={q.id}
                                type="button"
                                onClick={() => {
                                  updateSelectedQuestionIndex(index);
                                  setMessage("");
                                  setRevealedAnswer("");
                                }}
                                className={`min-h-[112px] rounded-2xl border px-4 py-4 text-center font-bold transition hover:scale-[1.03] ${
                                  index === selectedQuestionIndex
                                    ? "border-[#ff7a1a] bg-[#ff4b00] text-black shadow-[0_0_22px_rgba(255,75,0,0.45)]"
                                    : q.hintUsed
                                    ? "border-yellow-500 bg-yellow-950 text-yellow-200"
                                    : q.solved
                                    ? "border-green-500 bg-green-950 text-green-200"
                                    : qAttempted
                                    ? "border-red-500 bg-red-950 text-red-200"
                                    : "border-[#ff4b00]/45 bg-black text-orange-200"
                                }`}
                              >
                                <span className="block text-sm font-black opacity-80">
                                  Challenge {index + 1}
                                </span>

                                <span className="mt-2 block text-lg font-black">
                                  {q.hintUsed || qAttempted
                                    ? "0 pts"
                                    : `${q.points} pts`}
                                </span>

                                <span
                                  className={`mt-3 inline-flex rounded-full px-3 py-1 text-[11px] font-black ${
                                    q.hintUsed
                                      ? "bg-yellow-900 text-yellow-200"
                                      : q.solved
                                      ? "bg-green-900 text-green-200"
                                      : qAttempted
                                      ? "bg-red-900 text-red-200"
                                      : index === selectedQuestionIndex
                                      ? "bg-black/20 text-black"
                                      : "bg-[#ff4b00]/10 text-orange-200"
                                  }`}
                                >
                                  {q.hintUsed
                                    ? "Hint Used"
                                    : q.solved
                                    ? "Solved"
                                    : qAttempted
                                    ? "Submitted"
                                    : index === selectedQuestionIndex
                                    ? "Selected"
                                    : "Open"}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="mt-6 flex items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={goPreviousQuestion}
                          disabled={selectedQuestionIndex === 0}
                          className="rounded-xl border border-[#ff4b00]/50 px-5 py-3 font-bold text-orange-200 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Previous
                        </button>

                        <button
                          type="button"
                          onClick={goNextQuestion}
                          disabled={
                            selectedQuestionIndex === questions.length - 1
                          }
                          className="rounded-xl border border-[#ff4b00]/50 px-5 py-3 font-bold text-orange-200 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Next
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="cyber-card rounded-3xl p-8">
            <div className="mb-8 text-center">
              <p className="cyber-title text-sm text-[#ff4b00]">
                Answer Submission
              </p>

              <h1 className="cyber-title mt-3 text-4xl font-black">
                Submit <span className="text-[#ff4b00]">Answer</span>
              </h1>

              {selectedRound &&
                selectedQuestion &&
                !selectedRoundCompleted &&
                !selectedRoundGameOver && (
                  <p className="mt-3 text-gray-400">
                    For:{" "}
                    <span className="font-bold text-white">
                      Round {selectedRound.round_number} - Challenge{" "}
                      {selectedQuestionIndex + 1}
                    </span>
                  </p>
                )}
            </div>

            {selectedRoundGameOver ? (
              <div className="rounded-2xl border border-green-500/50 bg-green-950/30 p-6 text-center">
                <p className="cyber-title text-2xl text-green-300">
                  🏁 Game Over
                </p>
                <p className="mt-3 text-green-100/80">
                  All rounds are completed. Check your final dashboards.
                </p>
              </div>
            ) : selectedRoundCompleted ? (
              <div className="rounded-2xl border border-[#ff4b00]/50 bg-black/70 p-6 text-center">
                <p className="cyber-title text-2xl text-[#ff4b00]">
                  🎉 Round Completed
                </p>
                <p className="mt-3 text-gray-300">
                  No more submissions are needed for this round.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                {isMcq ? (
                  <div className="space-y-3">
                    {shuffledOptions.map((option, index) => (
                      <button
                        key={option.id}
                        type="button"
                        disabled={challengeClosed}
                        onClick={() => {
                          setFlag(option.id);
                          saveFlagToCache(option.id);
                        }}
                        className={`w-full rounded-2xl border px-5 py-4 text-left font-bold leading-relaxed transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50 ${
                          flag === option.id
                            ? "border-[#ff4b00] bg-[#ff4b00] text-black shadow-[0_0_22px_rgba(255,75,0,0.45)]"
                            : "border-[#ff4b00]/40 bg-black text-orange-100"
                        }`}
                      >
                        <div className="flex gap-4">
                          <span
                            className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-black ${
                              flag === option.id
                                ? "border-black text-black"
                                : "border-[#ff4b00]/60 text-[#ff4b00]"
                            }`}
                          >
                            {index + 1}
                          </span>

                          <span>{option.text}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : isMultiInput ? (
                  <div className="space-y-4">
                    {(selectedQuestion?.inputFields || []).map((field) => (
                      <div key={field.id}>
                        <label className="mb-2 block text-sm font-black tracking-[0.18em] text-[#ff7a1a]">
                          {field.label}
                        </label>

                        <input
                          disabled={challengeClosed}
                          value={answerValues[field.id] || ""}
                          onChange={(e) => {
                            setAnswerValues((prev) => {
                              const next = {
                                ...prev,
                                [field.id]: e.target.value,
                              };

                              saveAnswerValuesToCache(next);

                              return next;
                            });
                          }}
                          placeholder={`Enter ${field.label}`}
                          className="w-full rounded-2xl border border-[#ff4b00]/50 bg-black px-5 py-4 text-center text-lg font-bold text-white outline-none focus:border-[#ff4b00] disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <input
                    disabled={challengeClosed}
                    value={flag}
                    onChange={(e) => {
                      setFlag(e.target.value);
                      saveFlagToCache(e.target.value);
                    }}
                    placeholder="Enter flag here"
                    className="w-full rounded-2xl border border-[#ff4b00]/50 bg-black px-5 py-5 text-center text-lg text-white outline-none focus:border-[#ff4b00] disabled:cursor-not-allowed disabled:opacity-50"
                  />
                )}

                <button
                  disabled={
                    loading ||
                    rounds.length === 0 ||
                    !selectedQuestion ||
                    challengeClosed
                  }
                  className="cyber-button mt-5 w-full rounded-2xl py-5 text-lg disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading
                    ? "Checking..."
                    : selectedRoundEnded
                    ? "Time Over"
                    : mcqAlreadyAttempted
                    ? "Already Submitted"
                    : selectedQuestion?.hintUsed
                    ? "Hint Used"
                    : selectedQuestion?.solved
                    ? "Already Solved"
                    : isMcq
                    ? "Submit Answer"
                    : isMultiInput
                    ? "Submit Values"
                    : "Capture Flag"}
                </button>

                {!isRoundThree && (
                  <button
                    type="button"
                    onClick={handleHint}
                    disabled={
                      hintLoading ||
                      rounds.length === 0 ||
                      !selectedQuestion ||
                      selectedQuestion?.solved ||
                      selectedQuestion?.hintUsed ||
                      mcqAlreadyAttempted ||
                      selectedRoundEnded
                    }
                    className="mt-4 w-full rounded-2xl border border-yellow-500/60 bg-yellow-950/40 py-4 text-lg font-black text-yellow-200 shadow-[0_0_18px_rgba(234,179,8,0.18)] transition hover:bg-yellow-900/60 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {hintLoading
                      ? "Revealing..."
                      : "Hint / Reveal Answer (0 pts)"}
                  </button>
                )}

                {isRoundThree && (
                  <div className="mt-4 rounded-2xl border border-red-500/50 bg-red-950/40 p-4 text-center text-sm font-black text-red-200">
                    Hints are disabled in Round 3.
                  </div>
                )}
              </form>
            )}

            {message && (
              <div
                className={`mt-6 rounded-2xl border p-5 text-center text-lg font-bold ${
                  message.includes("FIRST BLOOD")
                    ? "border-red-600 bg-red-950 text-red-200 shadow-[0_0_25px_rgba(220,38,38,0.6)]"
                    : message.includes("Correct")
                    ? "border-green-500 bg-green-950 text-green-200"
                    : message.includes("Hint")
                    ? "border-yellow-500 bg-yellow-950/40 text-yellow-200"
                    : message.includes("Wrong") ||
                      message.includes("Time") ||
                      message.includes("disabled") ||
                      message.includes("not started")
                    ? "border-red-500 bg-red-950/50 text-red-200"
                    : "border-[#ff4b00]/50 bg-black text-orange-100"
                }`}
              >
                {message}
              </div>
            )}

            {revealedAnswer && (
              <div className="mt-5 rounded-2xl border border-yellow-500 bg-yellow-950/40 p-5 text-center">
                <p className="cyber-title text-xs text-yellow-300">
                  Revealed Answer - 0 Points
                </p>

                <pre className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-black p-4 text-lg font-black text-yellow-100">
                  {revealedAnswer}
                </pre>

                <p className="mt-3 text-sm font-bold text-yellow-200/80">
                  This challenge is unlocked with 0 points. You can move to the
                  next challenge.
                </p>
              </div>
            )}

            <div className="mt-8 grid gap-3">
              <button
                type="button"
                onClick={goDashboard}
                className="cyber-outline rounded-xl px-5 py-3 font-bold"
              >
                Back to Team Dashboard
              </button>

              <button
                type="button"
                onClick={goLeaderboard}
                className="cyber-outline rounded-xl px-5 py-3 font-bold"
              >
                View Global Dashboard
              </button>
            </div>
          </div>
        </div>
      </section>

      {showSolveAnimation && (
        <div className="solve-overlay">
          <div className="solve-card">
            <span className="solve-burst">🚩</span>
            <span className="solve-burst">💀</span>
            <span className="solve-burst">⚡</span>
            <span className="solve-burst">🔥</span>
            <span className="solve-burst">🚩</span>

            <div className="solve-title">
              {solveAnimationData.firstBlood
                ? "First Blood!"
                : "Flag Captured!"}
            </div>

            <div className="solve-subtitle">{solveAnimationData.title}</div>

            <div className="solve-points">
              +{solveAnimationData.points} Points
            </div>

            <div className="solve-joke">
              Hacker mode: activated. Coffee level: critical ☕
            </div>
          </div>
        </div>
      )}
    </main>
  );
}