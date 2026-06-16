import type { Metadata } from 'next'
import './globals.css'
import { Nav } from './_components/Nav'

export const metadata: Metadata = {
  title: 'zrux',
  description: 'A personal AI context engine for founders.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  )
}
