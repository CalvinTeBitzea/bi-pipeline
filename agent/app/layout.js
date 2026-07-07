// WHAT THIS FILE IS, IN BUSINESS TERMS
// -------------------------------------
// The outermost "picture frame" around every single page of this app — think
// of it like a shared header/footer template a print shop wraps around
// whatever page content you hand it.
//
// CONCEPT: Next.js App Router — layout.js vs. page.jsx
// -------------------------------------------------------------------------
// This project uses Next.js's "App Router" convention, where the URL
// structure of the app maps directly onto the folder structure of `app/`.
// Two special file names matter here:
//   - `layout.js`  — the shared wrapper: the <html>/<body> tags, page title,
//                    fonts/stylesheets, anything that should surround every
//                    page and NOT get re-created when navigating between
//                    pages.
//   - `page.jsx`   — the actual content for one specific URL (see
//                    app/page.jsx, which is the "/" home page).
// This app currently only has one page, so the distinction is subtle here —
// but it's what lets a bigger app add new pages later just by adding new
// `page.jsx` files, all automatically sharing this same outer frame.
import './globals.css'

export const metadata = {
  title: 'BI Agent',
  description: 'BI Requirements & Wireframe Agent',
}

export default function RootLayout({ children }) {
  // `children` is Next.js's way of handing this component "whatever page
  // content belongs here" — the same idea as a template's {{content}} slot.
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
