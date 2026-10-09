import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function GidaYardimiMuracaatPage() {
  redirect('/assistance/gida/muracaatlar')
}
