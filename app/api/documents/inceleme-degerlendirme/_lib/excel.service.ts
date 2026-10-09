import ExcelJS from 'exceljs'
import type { CevapDetay, IncelemeDegerlendirmeFormDetay } from './types'

function cevapMetni(cevap: CevapDetay): string {
  if (cevap.secimTuru === 'metin') return cevap.metinCevap || ''
  if (cevap.secimTuru === 'sayi') {
    const sayi = cevap.sayiCevap !== null ? `${cevap.sayiCevap} TL` : ''
    const secim = cevap.secilenSecenekMetinleri.join(', ')
    return [secim, sayi].filter(Boolean).join(' - ')
  }
  return cevap.secilenSecenekMetinleri.join(', ')
}

export async function buildIncelemeFormExcel(detay: IncelemeDegerlendirmeFormDetay): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'NetSosyal'
  workbook.created = new Date()

  const genelSheet = workbook.addWorksheet('Genel Bilgi')
  genelSheet.columns = [
    { header: 'Alan', key: 'alan', width: 28 },
    { header: 'Değer', key: 'deger', width: 50 },
  ]
  genelSheet.getRow(1).font = { bold: true }
  genelSheet.addRows([
    { alan: 'Dosya No', deger: detay.dosyaid },
    { alan: 'Tarih', deger: detay.tarih },
    { alan: 'TC Kimlik No', deger: detay.tcKimlikNo || '' },
    { alan: 'Ad Soyad', deger: detay.adSoyad || '' },
    { alan: 'Telefon', deger: detay.telefon || '' },
    { alan: 'Adres', deger: detay.adres || '' },
    { alan: 'Personel', deger: detay.personel || '' },
    { alan: 'Hane Kişi Sayısı', deger: detay.haneKisiSayisi ?? '' },
    { alan: 'Toplam Puan', deger: detay.toplamPuan ?? '' },
    { alan: 'Maksimum Puan', deger: detay.maksimumPuan },
    { alan: 'Karar', deger: detay.karar || '' },
    { alan: 'Yardım Türü Önerisi', deger: detay.yardimTuruOnerisi || '' },
    { alan: 'Eliminasyon Sonucu', deger: detay.eliminasyonSonucu || '' },
    { alan: 'Eliminasyon Red Nedeni', deger: detay.eliminasyonRedNedeni || '' },
    { alan: 'Onay Durumu', deger: detay.onayDurumu },
    { alan: 'Onay Notu', deger: detay.onayNotu || '' },
  ])

  const kriterSheet = workbook.addWorksheet('Kriter Cevaplari')
  kriterSheet.columns = [
    { header: 'Soru', key: 'soru', width: 40 },
    { header: 'Seçilen Seçenek', key: 'secenek', width: 50 },
    { header: 'Red Tetikledi mi', key: 'red', width: 18 },
  ]
  kriterSheet.getRow(1).font = { bold: true }
  for (const cevap of detay.cevaplar.filter((c) => c.bolum === 'kriter')) {
    const redOldu = detay.eliminasyonSonucu === 'RED' && (detay.eliminasyonRedNedeni ?? '').includes(cevap.soruMetni)
    kriterSheet.addRow({ soru: cevap.soruMetni, secenek: cevapMetni(cevap), red: redOldu ? 'Evet' : 'Hayır' })
  }

  const degSheet = workbook.addWorksheet('Degerlendirme Cevaplari')
  degSheet.columns = [
    { header: 'Soru', key: 'soru', width: 40 },
    { header: 'Seçilen Seçenek(ler)', key: 'secenek', width: 50 },
    { header: 'Puan', key: 'puan', width: 12 },
  ]
  degSheet.getRow(1).font = { bold: true }
  for (const cevap of detay.cevaplar.filter((c) => c.bolum === 'degerlendirme')) {
    degSheet.addRow({ soru: cevap.soruMetni, secenek: cevapMetni(cevap), puan: cevap.toplamPuan ?? '' })
  }

  const gozlemSheet = workbook.addWorksheet('Gozlem')
  gozlemSheet.columns = [
    { header: 'Soru', key: 'soru', width: 40 },
    { header: 'Cevap', key: 'cevap', width: 60 },
  ]
  gozlemSheet.getRow(1).font = { bold: true }
  for (const cevap of detay.cevaplar.filter((c) => c.bolum === 'gozlem')) {
    gozlemSheet.addRow({ soru: cevap.soruMetni, cevap: cevapMetni(cevap) })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
