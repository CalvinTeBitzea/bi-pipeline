/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
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
