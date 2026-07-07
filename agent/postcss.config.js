// WHAT THIS FILE IS, IN BUSINESS TERMS
// -------------------------------------
// PostCSS is a tool that transforms CSS after you write it, before it ships
// to the browser — think of it as a "spell-checker and translator" for
// stylesheets that runs as part of the build. This file just turns two
// plugins on:
//   - tailwindcss:  compiles Tailwind's utility classes (see
//                   tailwind.config.js) into real CSS rules.
//   - autoprefixer: automatically adds vendor-specific prefixes (e.g.
//                   `-webkit-`) so styles work consistently across
//                   different browsers, without writing them by hand.
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
