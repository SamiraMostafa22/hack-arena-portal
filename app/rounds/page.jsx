"use client";

import Header from "../components/Header";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function ProgressBar({ completed, total }) {
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-gray-400">
          {completed}/{total} completed
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

function getQuestionStatus(question) {
  if (question.hintUsed) {
    return {
      label: "Hint Used",
      className: "border-yellow-500 bg-yellow-950 text-yellow-200",
    };
  }

  if (question.solved) {
    return {
      label: "Solved",
      className: "border-green-500 bg-green-950 text-green-300",
    };
  }

  if (question.questionType === "mcq" && question.attempted) {
    return {
      label: "Submitted",
      className: "border-red-500 bg-red-950 text-red-200",
    };
  }

  return {
    label: "Open",
    className: "border-[#ff4b00]/50 bg-[#ff4b00]/10 text-orange-200",
  };
}

function getTypeLabel(type) {
  if (type === "mcq") return "MCQ";
  if (type === "multi_input") return "Multi Input";
  return "Flag";
}

function getRoundStatus(round) {
  if (round.roundCompleted) {
    return {
      label: "Completed",
      className: "border-green-500 bg-green-950 text-green-300",
    };
  }

  return {
    label: "Open",
    className: "border-[#ff4b00]/50 bg-[#ff4b00]/10 text-orange-200",
  };
}

export default function RoundsPage() {
  const router = useRouter();

  const [team, setTeam] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [gameOver, setGameOver] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  async function loadRounds() {
    try {
      const res = await fetch(`/api/rounds-data?t=${Date.now()}`, {
        cache: "no-store",
        credentials: "include",
      });

      if (res.status === 401) {
        localStorage.removeItem("team");
        router.push("/login");
        return;
      }

      const data = await res.json();

      if (data.success) {
        setRounds(data.rounds || []);
        setGameOver(!!data.gameOver);
        setErrorMessage("");
      } else {
        setRounds([]);
        setGameOver(false);
        setErrorMessage(data.message || "Could not load rounds.");
      }
    } catch (error) {
      setRounds([]);
      setGameOver(false);
      setErrorMessage(error.message || "Could not load rounds.");
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

    const savedTeam = JSON.parse(saved);

    setTeam(savedTeam);
    loadRounds();

    const interval = setInterval(() => {
      loadRounds();
    }, 5000);

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
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="cyber-title text-sm text-[#ff4b00]">
                Open Rounds
              </p>

              <h1 className="cyber-title mt-2 text-5xl font-black">
                Active <span className="text-[#ff4b00]">Challenges</span>
              </h1>

              <p className="mt-3 text-gray-400">
                Team:{" "}
                <span className="font-bold text-white">{team.team_name}</span>
              </p>

              <p className="mt-1 text-gray-500">
                Only opened rounds are visible here. Challenges open one by one.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => router.push("/team/submit")}
                className="cyber-button rounded-xl px-6 py-4"
              >
                Submit Flag
              </button>

              <button
                type="button"
                onClick={() => router.push("/team/dashboard")}
                className="cyber-outline rounded-xl px-6 py-4 font-bold"
              >
                Team Dashboard
              </button>

              <button
                type="button"
                onClick={() => router.push("/leaderboard")}
                className="cyber-outline rounded-xl px-6 py-4 font-bold"
              >
                Global Dashboard
              </button>
            </div>
          </div>

          {errorMessage && (
            <div className="mb-6 rounded-2xl border border-red-500 bg-red-950/50 p-5 text-center font-bold text-red-200">
              {errorMessage}
            </div>
          )}

          {loading && (
            <div className="cyber-card rounded-3xl p-8 text-center">
              Loading rounds...
            </div>
          )}

          {!loading && gameOver && (
            <div className="cyber-card rounded-3xl border border-green-500/50 bg-green-950/25 p-10 text-center">
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
                Excellent work. You can review your final score, solved answers,
                used hints, and ranking from the dashboards.
              </p>

              <div className="mt-8 flex flex-wrap justify-center gap-4">
                <button
                  type="button"
                  onClick={() => router.push("/team/dashboard")}
                  className="rounded-2xl bg-green-400 px-7 py-4 font-black text-black transition hover:scale-[1.04]"
                >
                  View Team Dashboard
                </button>

                <button
                  type="button"
                  onClick={() => router.push("/leaderboard")}
                  className="rounded-2xl border border-green-400/60 bg-black px-7 py-4 font-black text-green-200 transition hover:scale-[1.04]"
                >
                  View Global Dashboard
                </button>
              </div>
            </div>
          )}

          {!loading && !gameOver && rounds.length === 0 && (
            <div className="cyber-card rounded-3xl p-10 text-center">
              <p className="cyber-title text-2xl text-[#ff4b00]">
                No Open Rounds
              </p>

              <p className="mt-3 text-gray-400">
                Please wait until the next round is opened by the organizer.
              </p>
            </div>
          )}

          {!gameOver && rounds.length > 0 && (
            <div className="grid gap-6">
              {rounds.map((round) => {
                const completed =
                  round.completedQuestions !== undefined
                    ? round.completedQuestions
                    : round.questions?.filter((q) => q.completed).length || 0;

                const status = getRoundStatus(round);

                return (
                  <div key={round.id} className="cyber-card rounded-3xl p-6">
                    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <p className="text-sm text-[#ff7a1a]">
                          Round {round.round_number}
                        </p>

                        <h2 className="mt-1 text-3xl font-black">
                          {round.title}
                        </h2>
                      </div>

                      <span
                        className={`rounded-full border px-5 py-2 text-sm font-black uppercase tracking-[0.2em] ${status.className}`}
                      >
                        {status.label}
                      </span>
                    </div>

                    {round.description && (
                      <p className="mb-5 text-gray-400">{round.description}</p>
                    )}

                    <div className="mb-6 rounded-2xl border border-[#ff4b00]/30 bg-black/70 p-5">
                      <ProgressBar
                        completed={completed}
                        total={round.totalQuestions || 0}
                      />
                    </div>

                    {round.roundCompleted ? (
                      <div className="rounded-2xl border border-green-500/40 bg-green-950/30 p-8 text-center">
                        <p className="cyber-title text-2xl text-green-300">
                          🎉 Round {round.round_number} Completed
                        </p>

                        <p className="mt-3 text-green-100/80">
                          All challenges in this round are completed.
                        </p>

                        <div className="mt-6 flex flex-wrap justify-center gap-3">
                          <button
                            type="button"
                            onClick={() => router.push("/team/dashboard")}
                            className="rounded-xl border border-green-500 bg-green-950 px-5 py-3 font-bold text-green-200"
                          >
                            Team Dashboard
                          </button>

                          <button
                            type="button"
                            onClick={() => router.push("/leaderboard")}
                            className="rounded-xl border border-[#ff4b00]/50 bg-black px-5 py-3 font-bold text-orange-200"
                          >
                            Global Dashboard
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                          {(round.questions || []).map((question, index) => {
                            const questionStatus = getQuestionStatus(question);

                            return (
                              <div
                                key={question.id}
                                className="rounded-2xl border border-[#ff4b00]/30 bg-black/70 p-5"
                              >
                                <div className="mb-3 flex items-center justify-between gap-3">
                                  <p className="text-sm font-bold text-[#ff7a1a]">
                                    Question {index + 1}
                                  </p>

                                  <span className="rounded-full bg-[#ff4b00]/10 px-3 py-1 text-sm font-bold text-orange-200">
                                    {question.hintUsed ||
                                    (question.questionType === "mcq" &&
                                      question.attempted &&
                                      !question.solved)
                                      ? "0 pts"
                                      : `${question.points} pts`}
                                  </span>
                                </div>

                                <h3 className="text-xl font-black">
                                  {question.title}
                                </h3>

                                <div className="mt-4 flex flex-wrap gap-2">
                                  <span className="rounded-full border border-[#ff4b00]/40 bg-black px-3 py-1 text-xs font-bold text-gray-300">
                                    {getTypeLabel(question.questionType)}
                                  </span>

                                  <span className="rounded-full border border-[#ff4b00]/40 bg-black px-3 py-1 text-xs font-bold text-gray-300">
                                    {question.difficulty || "N/A"}
                                  </span>

                                  <span
                                    className={`rounded-full border px-3 py-1 text-xs font-bold ${questionStatus.className}`}
                                  >
                                    {questionStatus.label}
                                  </span>
                                </div>

                                {question.estimatedTime && (
                                  <p className="mt-3 text-sm text-gray-500">
                                    Estimated time: {question.estimatedTime}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {(round.questions || []).length === 0 && (
                          <p className="text-gray-400">
                            No questions added yet.
                          </p>
                        )}

                        <div className="mt-6 flex justify-end">
                          <button
                            type="button"
                            onClick={() => router.push("/team/submit")}
                            className="cyber-button rounded-xl px-6 py-4"
                          >
                            Continue Solving
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}