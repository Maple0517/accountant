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
      <body className="antialiased">
        {children}
      </body>
    </html>
  )
}
