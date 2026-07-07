// WHAT THIS FILE IS, IN BUSINESS TERMS
// -------------------------------------
// The configuration file for Next.js itself (the framework this whole chat
// app is built on) — the equivalent of a build tool's settings file. This
// project barely customizes anything: it just pins the project root so
// Next's bundler (Turbopack) knows unambiguously where the app lives, which
// matters when the app is nested inside a larger repo (this `agent/` folder
// sits alongside a separate `builder/` Python project in the same repo).
/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: __dirname,
  },
}
module.exports = nextConfig
