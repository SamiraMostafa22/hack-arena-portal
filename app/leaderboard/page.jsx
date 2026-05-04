"use client";

import Header from "../components/Header";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Orbitron } from "next/font/google";

const orbitron = Orbitron({
  subsets: ["latin"],
  weight: ["700", "800", "900"],
});

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

function formatLastSubmit(value) {
  if (!value) return "--";

  const time = getTimeMs(value);

  if (Number.isNaN(time)) return "--";

  return new Date(time).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function calculateTimer(startTime, endTime, nowMs) {
  if (!startTime || !endTime) {
    return {
      label: "Competition Timer",
      value: "--:--:--",
      phase: "idle",
      ended: false,
    };
  }

  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const start = getTimeMs(startTime);
  const end = getTimeMs(endTime);

  if (Number.isNaN(start) || Number.isNaN(end)) {
    return {
      label: "Competition Timer",
      value: "--:--:--",
      phase: "idle",
      ended: false,
    };
  }

  if (now < start) {
    const diff = start - now;
    const secondsLeft = Math.ceil(diff / 1000);

    return {
      label: "Round starts in",
      value: secondsLeft <= 10 ? String(secondsLeft) : formatDuration(diff),
      phase: "starting",
      ended: false,
    };
  }

  if (now - start <= 1500) {
    return {
      label: "",
      value: "ROUND START",
      phase: "go",
      ended: false,
    };
  }

  if (now < end) {
    return {
      label: "Round Time Remaining",
      value: formatDuration(end - now),
      phase: "running",
      ended: false,
    };
  }

  return {
    label: "Competition Closed",
    value: "00:00:00",
    phase: "ended",
    ended: true,
  };
}

function CountdownOverlay({ timer }) {
  const numericValue = Number(timer?.value);

  const shouldShow =
    timer?.phase === "go" ||
    (timer?.phase === "starting" &&
      Number.isFinite(numericValue) &&
      numericValue >= 1 &&
      numericValue <= 10);

  if (!shouldShow) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm">
      <div className="rounded-[2rem] border border-[#ff4b00]/70 bg-black/90 px-10 py-8 text-center shadow-[0_0_80px_rgba(255,75,0,0.45)]">
        {timer.phase === "starting" ? (
          <>
            <p className="cyber-title mb-4 text-sm uppercase tracking-[0.35em] text-[#ff7a1a]">
              Round starts in
            </p>

            <div className="font-mono text-8xl font-black leading-none text-[#ff4b00] drop-shadow-[0_0_35px_rgba(255,75,0,0.95)] md:text-9xl">
              {timer.value}
            </div>
          </>
        ) : (
          <>
            <p className="cyber-title mb-4 text-sm uppercase tracking-[0.35em] text-green-300">
              Ready
            </p>

            <div className="font-mono text-5xl font-black leading-none text-green-300 drop-shadow-[0_0_35px_rgba(34,197,94,0.95)] md:text-7xl">
              ROUND START
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function getRoundProgress(team, roundNumber) {
  return (
    (team.roundsProgress || []).find(
      (round) => Number(round.roundNumber) === Number(roundNumber)
    ) || {
      roundNumber,
      solved: 0,
      hints: 0,
      completed: 0,
      total: 0,
      score: 0,
    }
  );
}

function getTeamName(team) {
  return team.team_name || team.teamName || "Team";
}

function getTeamScore(team) {
  return team.score ?? team.totalScore ?? 0;
}

function getTeamSolved(team) {
  return team.solved ?? team.solvedCount ?? 0;
}

export default function GlobalLeaderboardPage() {
  const router = useRouter();

  const [data, setData] = useState(null);
  const [timer, setTimer] = useState({
    label: "Competition Timer",
    value: "--:--:--",
    phase: "idle",
    ended: false,
  });

  const [errorMessage, setErrorMessage] = useState("");
  const serverOffsetMsRef = useRef(0);

  function getServerNowMs() {
    return Date.now() + serverOffsetMsRef.current;
  }

  function syncServerOffset(serverNow, requestStartedAt, responseReceivedAt) {
    const serverNowMs = getTimeMs(serverNow);

    if (Number.isNaN(serverNowMs)) return;

    const latencyAdjustedClientNow =
      requestStartedAt + (responseReceivedAt - requestStartedAt) / 2;

    serverOffsetMsRef.current = serverNowMs - latencyAdjustedClientNow;
  }

  async function loadData() {
    try {
      const requestStartedAt = Date.now();

      const res = await fetch("/api/global-data");

      const result = await res.json();
      const responseReceivedAt = Date.now();

      if (result.serverNow) {
        syncServerOffset(
          result.serverNow,
          requestStartedAt,
          responseReceivedAt
        );
      }

      if (result.success) {
        setErrorMessage("");
        setData(result);
      } else {
        setErrorMessage(result.message || "Could not load global dashboard.");
        console.error(result.message);
      }
    } catch (error) {
      setErrorMessage(error.message || "Could not load global dashboard.");
      console.warn("Dashboard fetch skipped:", error.message);
    }
  }

  useEffect(() => {
    loadData();

    const fetchInterval = setInterval(loadData, 30000);

    return () => clearInterval(fetchInterval);
  }, []);

  useEffect(() => {
    function updateTimer() {
      const result = calculateTimer(
        data?.settings?.start_time,
        data?.settings?.end_time,
        getServerNowMs()
      );

      setTimer(result);
    }

    updateTimer();

    const interval = setInterval(updateTimer, 500);

    return () => clearInterval(interval);
  }, [data?.settings?.start_time, data?.settings?.end_time]);

  const teams = data?.leaderboard || [];
  const roundNumbers = [1, 2, 3];

  return (
    <main className="cyber-noise min-h-screen bg-[#050505] text-white">
      <Header />

      <CountdownOverlay timer={timer} />

      <section className="cyber-grid-bg relative min-h-[calc(100vh-132px)] overflow-hidden px-3 pb-4 pt-0 md:px-4">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#ff4b0028,transparent_35%),radial-gradient(circle_at_bottom,#8b1f0028,transparent_40%)]" />

        <div className="relative mx-auto w-full max-w-none">
          <div
            className={`relative mx-auto mb-4 w-full max-w-[95vw] overflow-hidden rounded-b-[2rem] border border-t-0 px-5 py-3 text-center shadow-[0_0_35px_rgba(255,75,0,0.16)] ${
              timer.phase === "ended"
                ? "timer-ended border-red-600/70 bg-black/85"
                : timer.phase === "starting"
                ? "border-yellow-500/70 bg-yellow-950/40"
                : timer.phase === "go"
                ? "border-green-500/70 bg-green-950/40 shadow-[0_0_45px_rgba(34,197,94,0.35)]"
                : "border-[#ff4b00]/35 bg-black/70"
            }`}
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,75,0,0.13),transparent_45%)]" />

            <div className="relative z-10 mb-2 flex justify-start">
              <button
                type="button"
                onClick={() => router.push("/team/dashboard")}
                className="rounded-xl border border-[#ff4b00]/50 bg-black px-4 py-2 text-xs font-black text-orange-200 transition hover:scale-[1.03] hover:bg-[#ff4b00]/10"
              >
                ← Back to Team Dashboard
              </button>
            </div>

            <p
              className={`relative z-10 text-xs font-black uppercase tracking-[0.28em] ${
                timer.phase === "ended"
                  ? "timer-ended-label"
                  : timer.phase === "starting"
                  ? "text-yellow-300"
                  : timer.phase === "go"
                  ? "text-green-300"
                  : "text-[#ff4b00]"
              }`}
            >
              {timer.label}
            </p>

            <div
              className={`${orbitron.className} relative z-10 mt-2 font-black leading-none tracking-[0.05em] ${
                timer.phase === "ended"
                  ? "timer-ended-text text-[2.4rem] md:text-[4rem]"
                  : timer.phase === "starting" && timer.value.length <= 2
                  ? "text-[5rem] text-yellow-300 drop-shadow-[0_0_28px_rgba(234,179,8,0.9)] md:text-[7rem]"
                  : timer.phase === "go"
                  ? "text-[2.4rem] text-green-300 drop-shadow-[0_0_30px_rgba(34,197,94,0.9)] md:text-[4rem]"
                  : "text-[2.4rem] text-[#ff4b00] drop-shadow-[0_0_22px_rgba(255,75,0,0.85)] md:text-[4rem]"
              }`}
            >
              {timer.value}
            </div>

            {timer.phase === "ended" && (
              <div className="time-up-badge">Time Is Up</div>
            )}

            <div className="relative z-10 mx-auto mt-2 h-[2px] w-60 max-w-full bg-gradient-to-r from-transparent via-[#ff4b00] to-transparent shadow-[0_0_14px_rgba(255,75,0,0.75)]" />

            <p className="relative z-10 mt-2 text-xs font-black uppercase tracking-[0.32em] text-orange-100 md:text-sm">
              {timer.phase === "ended"
                ? "Game Over. Logs Are Forever."
                : timer.phase === "starting"
                ? "Get Ready..."
                : timer.phase === "go"
                ? "Round Started!"
                : "Find. Exploit. Dominate."}
            </p>
          </div>

          {errorMessage && (
            <div className="mx-auto mb-4 max-w-[95vw] rounded-2xl border border-red-500 bg-red-950/50 p-4 text-center font-bold text-red-200">
              {errorMessage}
            </div>
          )}

          <div className="mb-2 flex items-center justify-between gap-3 px-1">
            <p className="text-sm font-black uppercase tracking-[0.22em] text-[#ff7a1a]">
              All Teams
            </p>

            <p className="rounded-full border border-[#ff4b00]/40 bg-black px-4 py-2 text-xs font-bold text-orange-200">
              Showing {teams.length} Teams
            </p>
          </div>

          <div className="w-full overflow-hidden rounded-3xl border border-[#ff4b00]/35 bg-black/70 shadow-[0_0_35px_rgba(255,75,0,0.13)]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1300px] border-collapse">
                <thead>
                  <tr className="border-b border-[#ff4b00]/25 bg-black/95 text-left text-[11px] uppercase tracking-[0.18em] text-slate-400">
                    <th className="px-4 py-3">Rank</th>
                    <th className="px-4 py-3">Team</th>
                    <th className="px-4 py-3">Score</th>
                    <th className="px-4 py-3">Solved</th>
                    <th className="px-4 py-3">First Blood</th>

                    {roundNumbers.map((roundNumber) => (
                      <th key={roundNumber} className="px-4 py-3 text-center">
                        R{roundNumber}
                      </th>
                    ))}

                    <th className="px-4 py-3">Last Submit</th>
                  </tr>
                </thead>

                <tbody>
                  {teams.map((team, index) => {
                    const rank = Number(team.rank || index + 1);

                    return (
                      <tr
                        key={team.id || team.teamId || index}
                        className={`border-b border-[#ff4b00]/20 ${
                          rank === 1
                            ? "bg-[#4b1700]"
                            : "bg-[linear-gradient(90deg,rgba(255,75,0,0.08),rgba(0,0,0,0.25))]"
                        }`}
                      >
                        <td className="px-4 py-2.5">
                          <div
                            className={`flex h-10 w-10 items-center justify-center rounded-xl text-base font-black ${
                              rank === 1
                                ? "bg-[#ff4b00] text-black shadow-[0_0_18px_rgba(255,75,0,0.6)]"
                                : rank === 2
                                ? "bg-slate-200 text-black"
                                : rank === 3
                                ? "bg-[#9b1f00] text-white"
                                : "border border-[#ff4b00]/40 bg-black text-white"
                            }`}
                          >
                            {rank}
                          </div>
                        </td>

                        <td className="min-w-[320px] px-4 py-2.5">
                          <span className="block whitespace-nowrap text-2xl font-black leading-none text-white md:text-[2rem]">
                            {getTeamName(team)}
                          </span>
                        </td>

                        <td className="px-4 py-2.5 text-3xl font-black text-[#ff4b00]">
                          {getTeamScore(team)}
                        </td>

                        <td className="px-4 py-2.5 text-2xl font-black text-white">
                          {getTeamSolved(team)}
                        </td>

                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-2 text-xl font-black text-[#ff4b00]">
                            <span className="text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.9)]">
                              🩸
                            </span>
                            {team.firstBloods || 0}
                          </span>
                        </td>

                        {roundNumbers.map((roundNumber) => {
                          const progress = getRoundProgress(team, roundNumber);

                          const passedCount =
                            progress.completed !== undefined
                              ? progress.completed
                              : (progress.solved || 0) +
                                (progress.hints || 0);

                          const percent =
                            progress.total > 0
                              ? Math.round(
                                  (passedCount / progress.total) * 100
                                )
                              : 0;

                          return (
                            <td
                              key={roundNumber}
                              className="px-4 py-2.5 text-center"
                            >
                              <div className="mx-auto w-20">
                                <div className="text-sm font-black text-white">
                                  {progress.solved || 0}/{progress.total || 0}
                                </div>

                                {progress.hints > 0 && (
                                  <div className="mt-0.5 text-[10px] font-black text-yellow-300">
                                    Hints: {progress.hints}
                                  </div>
                                )}

                                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-black shadow-inner">
                                  <div
                                    className={`h-full rounded-full ${
                                      progress.hints > 0
                                        ? "bg-yellow-400"
                                        : "bg-[#ff4b00]"
                                    }`}
                                    style={{
                                      width: `${percent}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            </td>
                          );
                        })}

                        <td className="px-4 py-2.5 text-base text-gray-300">
                          {formatLastSubmit(team.lastSubmit)}
                        </td>
                      </tr>
                    );
                  })}

                  {teams.length === 0 && (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-6 py-10 text-center text-lg text-gray-400"
                      >
                        No teams found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
            <div className="rounded-full border border-[#ff4b00]/40 bg-black px-3 py-1.5 text-orange-200">
              Showing all teams
            </div>

            <div className="rounded-full border border-[#ff4b00]/40 bg-black px-3 py-1.5 text-orange-200">
              Score = normal solves only
            </div>

            <div className="rounded-full border border-yellow-500/60 bg-yellow-950 px-3 py-1.5 text-yellow-200">
              Yellow progress = Hint used / 0 pts
            </div>

            <div className="rounded-full border border-red-500/60 bg-red-950 px-3 py-1.5 text-red-100">
              🩸 First Blood = normal solve only
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}