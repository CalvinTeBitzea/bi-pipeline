// WHAT THIS FILE IS, IN BUSINESS TERMS
// -------------------------------------
// The actual content of the app's one and only page ("/") — and it's
// intentionally almost empty. All of the real UI (sidebar, chat window,
// message list) lives inside the ChatInterface component; this file's only
// job is to say "when someone visits the home page, show them that
// component." Keeping page.jsx this thin is a common Next.js pattern: pages
// wire together components, they don't contain business logic themselves.
import ChatInterface from '../components/ChatInterface'

export default function Home() {
  return <ChatInterface />
}
