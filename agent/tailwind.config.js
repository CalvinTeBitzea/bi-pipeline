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
  // CONCEPT: class-based dark mode
  // -------------------------------------------------------------------------
  // Tailwind's DEFAULT dark-mode strategy is 'media' — it only reacts to the
  // operating system's own light/dark setting, and completely ignores any
  // class you put on the page. This app has an in-app dark-mode TOGGLE
  // button (see ChatInterface.jsx's `darkMode` state, which adds/removes a
  // `dark` class on <html>) — that toggle only has any effect once Tailwind
  // is told to key off a CLASS instead of the OS setting, which is what this
  // line does.
  darkMode: 'class',
  theme: {
    extend: {
      // This app's specific color palette — an "editorial newsroom" look
      // (warm off-white paper tones, near-black ink, one accent red) rather
      // than Tailwind's generic defaults.
      //
      // CONCEPT: Colors backed by CSS variables, not fixed hex values
      // -----------------------------------------------------------------
      // Every one of these colors is used throughout the app with Tailwind's
      // opacity-modifier syntax (e.g. `border-ink/10`, `bg-red/5`,
      // `text-muted/60`) — hundreds of call sites across ChatInterface.jsx
      // alone. Rather than rewrite every one of those into a `dark:`-prefixed
      // pair (`text-ink dark:text-something`), each color name here resolves
      // to a CSS VARIABLE (defined in globals.css) instead of a fixed hex
      // value. Flipping the `.dark` class then just redefines what "ink"
      // and "paper" MEAN, and every existing class — including every
      // opacity-modified one, already written and already deployed —
      // automatically follows, with zero JSX changes required. The
      // `<alpha-value>` placeholder is Tailwind's documented syntax for
      // making that opacity-modifier syntax keep working with a
      // variable-backed color; it requires the CSS variable itself to hold
      // space-separated R G B numbers, not a hex string (see globals.css).
      colors: {
        paper:    'rgb(var(--c-paper) / <alpha-value>)',
        offwhite: 'rgb(var(--c-offwhite) / <alpha-value>)',
        ink:      'rgb(var(--c-ink) / <alpha-value>)',
        red:      'rgb(var(--c-red) / <alpha-value>)',
        muted:    'rgb(var(--c-muted) / <alpha-value>)',
        surface:  'rgb(var(--c-surface) / <alpha-value>)',
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
