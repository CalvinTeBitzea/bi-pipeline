// WHAT THIS FILE IS, IN BUSINESS TERMS
// -------------------------------------
// The design-system settings for this app's CSS. Tailwind is a "utility-
// first" CSS framework: instead of writing custom stylesheets by hand, you
// style elements directly in the markup with small pre-built classes (e.g.
// `text-ink`, `bg-offwhite`). This file is where this project's own brand
// colors and fonts get registered as new Tailwind utilities, so the rest of
// the codebase can write `className="text-red"` and get THIS app's specific
// red, not a generic one.
/** @type {import('tailwindcss').Config} */
module.exports = {
  // Tells Tailwind exactly which files to scan for class names in use — it
  // only generates CSS for classes it actually finds referenced, keeping the
  // final stylesheet small instead of shipping every utility it's capable of.
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      // This app's specific color palette — an "editorial newsroom" look
      // (warm off-white paper tones, near-black ink, one accent red) rather
      // than Tailwind's generic defaults.
      colors: {
        paper:  '#E8E4DD',
        offwhite: '#F5F3EE',
        ink:    '#111111',
        red:    '#E63B2E',
        muted:  '#888888',
        surface: '#DAD6CE',
      },
      fontFamily: {
        grotesk: ['"Space Grotesk"', 'sans-serif'],
        mono:    ['"Space Mono"', 'monospace'],
        serif:   ['"DM Serif Display"', 'serif'],
      },
    },
  },
  plugins: [],
}
