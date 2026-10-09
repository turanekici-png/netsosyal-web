import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function HazirYemekMuracaatPage() {
  redirect('/assistance/hazir-yemek/muracaatlar')
}
