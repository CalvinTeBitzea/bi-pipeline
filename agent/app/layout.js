import './globals.css'

export const metadata = {
  title: 'BI Agent',
  description: 'BI Requirements & Wireframe Agent',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
