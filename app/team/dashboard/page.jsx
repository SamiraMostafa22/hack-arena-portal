"use client";

import Header from "../../components/Header";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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

function Timer({ startTime, endTime, serverOffsetMs = 0 }) {
  const [timer, setTimer] = useState({
    label: "Timer",
    value: "--:--:--",
    phase: "idle",
  });

  const serverOffsetRef = useRef(0);

  useEffect(() => {
    serverOffsetRef.current = Number.isFinite(serverOffsetMs)
      ? serverOffsetMs
      : 0;
  }, [serverOffsetMs]);

  function formatTime(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
      2,
      "0"
    )}:${String(seconds).padStart(2, "0")}`;
  }

  useEffect(() => {
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
        const diff = start - now;
        const secondsLeft = Math.ceil(diff / 1000);

        setTimer({
          label: "Round starts in",
          value: secondsLeft <= 10 ? String(secondsLeft) : formatTime(diff),
          phase: "starting",
        });
        return;
      }

      if (now - start <= 1500) {
        setTimer({
          label: "",
          value: "ROUND START",
          phase: "go",
        });
        return;
      }

      if (now < end) {
        setTimer({
          label: "Time left",
          value: formatTime(end - now),
          phase: "running",
        });
        return;
      }

      setTimer({
        label: "Time is over",
        value: "00:00:00",
        phase: "ended",
      });
    }

    updateTimer();

    const interval = setInterval(updateTimer, 500);

    return () => clearInterval(interval);
  }, [startTime, endTime]);

  return (
    <>
      <CountdownOverlay timer={timer} />

      <h2
        className={`mt-2 font-mono text-4xl font-black leading-none ${
          timer.phase === "ended"
            ? "text-red-400"
            : timer.phase === "starting"
            ? "text-yellow-300"
            : timer.phase === "go"
            ? "text-green-300"
            : "text-[#ff4b00]"
        }`}
      >
        {timer.value}
      </h2>

      {timer.phase === "ended" && (
        <p className="mt-2 text-xs font-bold text-red-300">Time is over</p>
      )}
    </>
  );
}

function ProgressBar({ solved, total, label = "completed" }) {
  const percent = total === 0 ? 0 : Math.round((solved / total) * 100);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-gray-400">
          {solved}/{total} {label}
        </span>

        <span className="text-[#ff7a1a]">{percent}%</span>
      </div>

      <div className="h-3 rounded-full bg-black">
        <div
          className="h-3 rounded-full bg-[#ff4b00] shadow-lg shadow-orange-600/40"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function EmptyBox({ text }) {
  return (
    <div className="rounded-2xl border border-[#ff4b00]/30 bg-black/70 p-8 text-center text-gray-400">
      {text}
    </div>
  );
}

function PointsBadge({ isHint, points }) {
  return (
    <span
      className={`inline-flex min-w-[86px] items-center justify-center whitespace-nowrap rounded-full border px-4 py-2 text-sm font-black ${
        isHint
          ? "border-yellow-500 bg-yellow-950 text-yellow-200"
          : "border-green-500 bg-green-950 text-green-300"
      }`}
    >
      {isHint ? "0 pts" : `+${points || 0}`}
    </span>
  );
}

function getRoundStatus(round) {
  if (round.roundCompleted) {
    return {
      text: "Completed",
      className: "border-green-500 bg-green-950 text-green-300",
    };
  }

  if (round.isActive) {
    return {
      text: "Active",
      className: "border-[#ff4b00]/50 bg-[#ff4b00]/10 text-orange-200",
    };
  }

  if (round.total === 0) {
    return {
      text: "No Flags",
      className: "border-slate-500 bg-slate-950 text-slate-300",
    };
  }

  return {
    text: "Locked",
    className: "border-slate-600 bg-black text-slate-400",
  };
}

export default function TeamDashboard() {
  const router = useRouter();

  const [team, setTeam] = useState(null);
  const [stats, setStats] = useState(null);
  const [settings, setSettings] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [historyItems, setHistoryItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [serverOffsetMs, setServerOffsetMs] = useState(0);

  function syncServerOffset(serverNow, requestStartedAt, responseReceivedAt) {
    const serverNowMs = getTimeMs(serverNow);

    if (Number.isNaN(serverNowMs)) return;

    const latencyAdjustedClientNow =
      requestStartedAt + (responseReceivedAt - requestStartedAt) / 2;

    setServerOffsetMs(serverNowMs - latencyAdjustedClientNow);
  }

  async function loadData() {
    try {
      const requestStartedAt = Date.now();

      const res = await fetch("/api/team-data", {
        cache: "no-store",
        credentials: "include",
      });

      const data = await res.json();
      const responseReceivedAt = Date.now();

      if (data.serverNow) {
        syncServerOffset(data.serverNow, requestStartedAt, responseReceivedAt);
      }

      if (!data.success) {
        setErrorMessage(data.message || "Could not load dashboard data.");

        if (res.status === 401) {
          localStorage.removeItem("team");
          router.push("/login");
        }

        return;
      }

      setErrorMessage("");
      setStats(data.stats);
      setSettings(data.settings);
      setLeaderboard(data.leaderboard || []);
      setRounds(data.roundsProgress || []);
      setHistoryItems(data.historyItems || []);
    } catch (error) {
      setErrorMessage(error.message || "Could not load dashboard data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const saved = localStorage.getItem("team");

    if (!saved) {
      router.push("/login");
      return;
    }

    try {
      const savedTeam = JSON.parse(saved);
      setTeam(savedTeam);
    } catch {
      localStorage.removeItem("team");
      router.push("/login");
      return;
    }

    loadData();

    const interval = setInterval(() => {
      loadData();
    }, 30000);

    return () => clearInterval(interval);
  }, [router]);

  if (!team) {
    return (
      <main className="min-h-screen bg-black p-8 text-white">Loading...</main>
    );
  }

  return (
    <main className="cyber-noise min-h-screen bg-[#050505] text-white">
      <Header />

      <section className="cyber-grid-bg relative overflow-hidden px-6 py-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,#ff4b0033,transparent_35%),radial-gradient(circle_at_bottom_right,#9b1f0033,transparent_40%)]" />

        <div className="relative mx-auto max-w-7xl">
          <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="cyber-title text-sm text-[#ff4b00]">
                Team Dashboard
              </p>

              <h1 className="mt-2 text-4xl font-black">
                Welcome,{" "}
                <span className="text-[#ff4b00]">{team.team_name}</span>
              </h1>

              <p className="mt-2 text-gray-400">
                Track your score, history, round progress, and live ranking.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => router.push("/team/submit")}
                className="cyber-button rounded-xl px-5 py-3"
              >
                Submit Flag
              </button>

              <button
                onClick={() => router.push("/leaderboard")}
                className="cyber-outline rounded-xl px-5 py-3 font-bold"
              >
                Global Dashboard
              </button>

              <button
                onClick={() => {
                  localStorage.removeItem("team");
                  router.push("/login");
                }}
                className="rounded-xl border border-[#ff4b00]/50 bg-black px-5 py-3 text-orange-200 hover:bg-[#ff4b00]/10"
              >
                Logout
              </button>
            </div>
          </div>

          {errorMessage && (
            <div className="mb-6 rounded-2xl border border-red-500 bg-red-950/50 p-5 text-center font-bold text-red-200">
              {errorMessage}
            </div>
          )}

          {loading && (
            <div className="mb-6 rounded-2xl border border-[#ff4b00]/30 bg-black/70 p-5 text-center text-orange-200">
              Loading dashboard data...
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-6">
            {[
              ["Score", stats?.score || 0],
              ["Rank", `#${stats?.rank || "-"}`],
              ["Solved", stats?.solved || 0],
              ["Hints", stats?.hints || 0],
              ["First Blood", `🩸 ${stats?.firstBlood || 0}`],
            ].map(([label, value]) => (
              <div key={label} className="cyber-card rounded-3xl p-6">
                <p className="text-gray-400">{label}</p>

                <h2 className="mt-2 text-4xl font-black text-[#ff4b00]">
                  {value}
                </h2>
              </div>
            ))}

            <div className="cyber-card rounded-3xl p-6">
              <p className="text-gray-400">Timer</p>

              {settings?.start_time && settings?.end_time ? (
                <Timer
                  startTime={settings.start_time}
                  endTime={settings.end_time}
                  serverOffsetMs={serverOffsetMs}
                />
              ) : (
                <h2 className="mt-2 text-4xl font-black text-[#ff4b00]">
                  --:--:--
                </h2>
              )}
            </div>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <div className="cyber-card rounded-3xl p-6 lg:col-span-2">
              <p className="cyber-title text-sm text-[#ff4b00]">Rounds</p>

              <h2 className="mt-2 text-3xl font-black">Round Progress</h2>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {rounds.length > 0 ? (
                  rounds.map((round) => {
                    const completedValue =
                      round.completed !== undefined
                        ? round.completed
                        : round.solved;

                    const status = getRoundStatus(round);

                    return (
                      <div
                        key={round.roundNumber}
                        className="rounded-2xl border border-[#ff4b00]/30 bg-black/70 p-5"
                      >
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm text-[#ff7a1a]">
                              Round {round.roundNumber}
                            </p>

                            <h3 className="mt-1 text-xl font-black">
                              {round.title}
                            </h3>
                          </div>

                          <span
                            className={`rounded-full border px-3 py-1 text-sm font-bold ${status.className}`}
                          >
                            {status.text}
                          </span>
                        </div>

                        <ProgressBar
                          solved={completedValue}
                          total={round.total}
                          label="completed"
                        />

                        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                          <div className="rounded-xl border border-green-500/30 bg-green-950/30 p-3">
                            <p className="text-xs text-green-200">Solved</p>

                            <p className="text-xl font-black text-green-300">
                              {round.solved || 0}
                            </p>
                          </div>

                          <div className="rounded-xl border border-yellow-500/30 bg-yellow-950/30 p-3">
                            <p className="text-xs text-yellow-200">Hints</p>

                            <p className="text-xl font-black text-yellow-300">
                              {round.hints || 0}
                            </p>
                          </div>

                          <div className="rounded-xl border border-[#ff4b00]/30 bg-[#ff4b00]/10 p-3">
                            <p className="text-xs text-orange-200">Score</p>

                            <p className="text-xl font-black text-[#ff4b00]">
                              {round.score || 0}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-gray-400">No rounds data yet.</p>
                )}
              </div>
            </div>

            <div className="cyber-card rounded-3xl p-6">
              <p className="cyber-title text-sm text-[#ff4b00]">Ranking</p>

              <h2 className="mt-2 text-3xl font-black">Top Teams</h2>

              <div className="mt-5 max-h-[460px] space-y-3 overflow-auto pr-2">
                {leaderboard.slice(0, 10).map((item, index) => (
                  <div
                    key={item.id}
                    className={`flex items-center justify-between rounded-2xl border p-4 ${
                      String(item.id) === String(team.id)
                        ? "border-[#ff4b00] bg-[#ff4b00]/15"
                        : "border-[#ff4b00]/25 bg-black/70"
                    }`}
                  >
                    <div>
                      <p className="font-bold">
                        #{item.rank || index + 1} {item.team_name}
                      </p>

                      <p className="text-sm text-gray-500">
                        Solved: {item.solved}
                      </p>
                    </div>

                    <p className="whitespace-nowrap text-xl font-black text-[#ff4b00]">
                      {item.score} pts
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="cyber-card mt-6 rounded-3xl p-6">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="cyber-title text-sm text-[#ff4b00]">
                  Team History
                </p>

                <h2 className="mt-2 text-3xl font-black">
                  Answers & Hints History
                </h2>

                <p className="mt-2 text-gray-400">
                  Review all solved answers and used hints in one table.
                </p>
              </div>

              <span className="rounded-full border border-[#ff4b00]/50 bg-[#ff4b00]/10 px-4 py-2 text-sm font-black text-orange-200">
                {historyItems.length} records
              </span>
            </div>

            {historyItems.length === 0 ? (
              <EmptyBox text="No history yet." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] border-separate border-spacing-y-3">
                  <thead>
                    <tr className="text-left text-sm text-gray-400">
                      <th className="min-w-[120px] px-4">Type</th>
                      <th className="min-w-[130px] px-4 text-center">Round</th>
                      <th className="px-4">Challenge</th>
                      <th className="px-4">Answer / Hint</th>
                      <th className="min-w-[120px] px-4 text-center">
                        Points
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {historyItems.map((item, index) => {
                      const isHint = item.type === "hint";

                      return (
                        <tr
                          key={`${item.type}-${item.flagId}-${index}`}
                          className="bg-black/70"
                        >
                          <td className="min-w-[120px] rounded-l-2xl border-y border-l border-[#ff4b00]/25 px-4 py-4">
                            <span
                              className={`inline-flex min-w-[82px] items-center justify-center whitespace-nowrap rounded-full border px-4 py-2 text-sm font-black ${
                                isHint
                                  ? "border-yellow-500 bg-yellow-950 text-yellow-200"
                                  : "border-green-500 bg-green-950 text-green-300"
                              }`}
                            >
                              {isHint ? "Hint" : "Solved"}
                            </span>
                          </td>

                          <td className="min-w-[130px] whitespace-nowrap border-y border-[#ff4b00]/25 px-4 py-4 text-center font-bold text-orange-200">
                            Round {item.roundNumber}
                          </td>

                          <td className="border-y border-[#ff4b00]/25 px-4 py-4">
                            <p className="font-black text-white">
                              #{item.challengeOrder} - {item.flagTitle}
                            </p>

                            <p className="mt-1 text-sm text-gray-500">
                              {item.questionType || "flag"}
                            </p>
                          </td>

                          <td className="border-y border-[#ff4b00]/25 px-4 py-4">
                            <pre
                              className={`max-w-[420px] whitespace-pre-wrap break-words rounded-xl border p-3 text-sm font-bold ${
                                isHint
                                  ? "border-yellow-500/30 bg-yellow-950/30 text-yellow-100"
                                  : "border-green-500/30 bg-green-950/30 text-green-100"
                              }`}
                            >
                              {isHint
                                ? item.hintText || "Hint used"
                                : item.submittedAnswer || "Solved"}
                            </pre>
                          </td>

                          <td className="min-w-[120px] rounded-r-2xl border-y border-r border-[#ff4b00]/25 px-4 py-4 text-center">
                            <PointsBadge isHint={isHint} points={item.points} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="cyber-card mt-6 rounded-3xl p-6">
            <p className="cyber-title text-sm text-[#ff4b00]">Quick Actions</p>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <button
                onClick={() => router.push("/team/submit")}
                className="cyber-button rounded-2xl px-6 py-5 text-lg"
              >
                Capture New Flag
              </button>

              <button
                onClick={() => router.push("/leaderboard")}
                className="cyber-outline rounded-2xl px-6 py-5 text-lg font-black"
              >
                Open Global Dashboard
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}