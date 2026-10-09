import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function DestekPaketiMuracaatPage() {
  redirect('/assistance/destek-paketi/muracaatlar')
}
