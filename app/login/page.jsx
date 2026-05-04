"use client";

import Header from "../components/Header";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();

  const [teamName, setTeamName] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();

    setLoading(true);
    setMessage("");

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          teamName: teamName.trim(),
          password,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        setMessage(data.message || "Login failed.");
        return;
      }

      // Public display data only.
      // The real secure login is now inside HttpOnly cookie from /api/login.
      localStorage.setItem(
        "team",
        JSON.stringify({
          id: data.team?.id,
          team_name: data.team?.team_name,
          total_score: data.team?.total_score || 0,
          created_at: data.team?.created_at || null,
        })
      );

      router.push("/team/dashboard");
    } catch (error) {
      setMessage("Could not login. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="cyber-noise min-h-screen bg-[#050505] text-white">
      <Header />

      <section className="cyber-grid-bg relative flex min-h-[calc(100vh-132px)] items-center justify-center overflow-hidden p-6">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#ff4b0033,transparent_35%),radial-gradient(circle_at_bottom,#9b1f0033,transparent_40%)]" />

        <form
          onSubmit={handleLogin}
          className="cyber-card relative w-full max-w-md rounded-3xl p-8"
        >
          <p className="cyber-title text-sm font-black text-[#ff4b00]">
            Hack Arena
          </p>

          <h1 className="cyber-title mt-3 text-4xl font-black text-white">
            Enter The Arena
          </h1>

          <p className="mt-4 text-sm text-gray-400">
            Write your team name exactly. On first login, your password will be
            created.
          </p>

          <input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="Team Name"
            autoComplete="username"
            className="mt-6 w-full rounded-xl border border-[#ff4b00]/50 bg-black px-4 py-4 text-white outline-none focus:border-[#ff4b00]"
          />

          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            type="password"
            autoComplete="current-password"
            className="mt-4 w-full rounded-xl border border-[#ff4b00]/50 bg-black px-4 py-4 text-white outline-none focus:border-[#ff4b00]"
          />

          <button
            disabled={loading}
            className="cyber-button mt-6 w-full rounded-xl py-4 disabled:opacity-50"
          >
            {loading ? "Checking..." : "Login"}
          </button>

          {message && (
            <p className="mt-4 rounded-xl border border-[#ff4b00]/40 bg-black p-4 text-center text-sm text-orange-100">
              {message}
            </p>
          )}
        </form>
      </section>
    </main>
  );
}