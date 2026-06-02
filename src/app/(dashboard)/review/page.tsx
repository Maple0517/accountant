import { redirect } from 'next/navigation'

export default function ReviewRedirectPage() {
  redirect('/transactions?savedView=needs_review')
}
