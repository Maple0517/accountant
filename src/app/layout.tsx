import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Accountant | Personal Finance',
  description: 'Smart personal finance tracker with Plaid integration and AI receipt parsing.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-[#0a0a0f] text-white selection:bg-[#6c5ce7] selection:text-white">
        {children}
      </body>
    </html>
  )
}
