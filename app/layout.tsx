import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'zrux',
  description: 'A personal AI context engine for founders.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
