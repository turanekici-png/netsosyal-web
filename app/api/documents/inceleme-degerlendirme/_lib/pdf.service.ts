import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { CevapDetay, IncelemeDegerlendirmeFormDetay } from './types'

const SAYFA_GENISLIK = 595.28 // A4
const SAYFA_YUKSEKLIK = 841.89
const KENAR_BOSLUK = 40
const ICERIK_GENISLIK = SAYFA_GENISLIK - KENAR_BOSLUK * 2

const KARAR_RENKLERI: Record<string, [number, number, number]> = {
  Kritik: [0.86, 0.15, 0.15],
  Yuksek: [0.92, 0.55, 0.1],
  Orta: [0.95, 0.75, 0.1],
  Dusuk: [0.2, 0.55, 0.85],
  'Yardim Gerekmiyor': [0.2, 0.65, 0.35],
}

class PdfWriter {
  doc: PDFDocument
  page: PDFPage
  y: number
  font: PDFFont
  fontBold: PDFFont

  constructor(doc: PDFDocument, font: PDFFont, fontBold: PDFFont) {
    this.doc = doc
    this.font = font
    this.fontBold = fontBold
    this.page = doc.addPage([SAYFA_GENISLIK, SAYFA_YUKSEKLIK])
    this.y = SAYFA_YUKSEKLIK - KENAR_BOSLUK
  }

  private ensureSpace(gerekliYukseklik: number) {
    if (this.y - gerekliYukseklik < KENAR_BOSLUK) {
      this.page = this.doc.addPage([SAYFA_GENISLIK, SAYFA_YUKSEKLIK])
      this.y = SAYFA_YUKSEKLIK - KENAR_BOSLUK
    }
  }

  // pdf-lib otomatik satir kaydirma yapmaz - kelime bazli manuel sarma.
  private wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    const words = text.split(/\s+/).filter(Boolean)
    const lines: string[] = []
    let current = ''

    for (const word of words) {
      const aday = current ? `${current} ${word}` : word
      if (font.widthOfTextAtSize(aday, size) > maxWidth && current) {
        lines.push(current)
        current = word
      } else {
        current = aday
      }
    }
    if (current) lines.push(current)
    return lines.length > 0 ? lines : ['']
  }

  baslik(text: string) {
    this.ensureSpace(28)
    this.page.drawText(text, { x: KENAR_BOSLUK, y: this.y, size: 16, font: this.fontBold, color: rgb(0.1, 0.1, 0.15) })
    this.y -= 26
  }

  altBaslik(text: string) {
    this.ensureSpace(20)
    this.page.drawText(text, { x: KENAR_BOSLUK, y: this.y, size: 12, font: this.fontBold, color: rgb(0.15, 0.2, 0.3) })
    this.y -= 18
  }

  satir(label: string, value: string) {
    const lines = this.wrapText(value || '-', this.font, 10, ICERIK_GENISLIK - 130)
    this.ensureSpace(14 * lines.length)
    this.page.drawText(label, { x: KENAR_BOSLUK, y: this.y, size: 10, font: this.fontBold, color: rgb(0.3, 0.3, 0.35) })
    lines.forEach((line, index) => {
      this.page.drawText(line, { x: KENAR_BOSLUK + 130, y: this.y - index * 13, size: 10, font: this.font, color: rgb(0.1, 0.1, 0.1) })
    })
    this.y -= 13 * lines.length + 4
  }

  paragraf(text: string, size = 10) {
    const lines = this.wrapText(text || '-', this.font, size, ICERIK_GENISLIK)
    this.ensureSpace(14 * lines.length)
    lines.forEach((line) => {
      this.page.drawText(line, { x: KENAR_BOSLUK, y: this.y, size, font: this.font, color: rgb(0.1, 0.1, 0.1) })
      this.y -= 14
    })
  }

  bosluk(miktar = 8) {
    this.y -= miktar
  }

  kutu(text: string, renk: [number, number, number]) {
    this.ensureSpace(30)
    this.page.drawRectangle({ x: KENAR_BOSLUK, y: this.y - 22, width: ICERIK_GENISLIK, height: 26, color: rgb(...renk), opacity: 0.15 })
    this.page.drawText(text, { x: KENAR_BOSLUK + 10, y: this.y - 16, size: 12, font: this.fontBold, color: rgb(...renk) })
    this.y -= 34
  }

  cizgi() {
    this.ensureSpace(10)
    this.page.drawLine({
      start: { x: KENAR_BOSLUK, y: this.y },
      end: { x: SAYFA_GENISLIK - KENAR_BOSLUK, y: this.y },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.82),
    })
    this.y -= 12
  }
}

function cevapMetni(cevap: CevapDetay): string {
  if (cevap.secimTuru === 'metin') return cevap.metinCevap || '-'
  if (cevap.secimTuru === 'sayi') {
    const sayi = cevap.sayiCevap !== null ? `${cevap.sayiCevap} TL` : ''
    const secim = cevap.secilenSecenekMetinleri.join(', ')
    return [secim, sayi].filter(Boolean).join(' - ') || '-'
  }
  return cevap.secilenSecenekMetinleri.join(', ') || '-'
}

export async function buildIncelemeFormPdf(detay: IncelemeDegerlendirmeFormDetay): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)

  const [regularBytes, boldBytes] = await Promise.all([
    fs.readFile(path.join(process.cwd(), 'public/fonts/arial.ttf')),
    fs.readFile(path.join(process.cwd(), 'public/fonts/arialbd.ttf')),
  ])
  const font = await doc.embedFont(regularBytes, { subset: true })
  const fontBold = await doc.embedFont(boldBytes, { subset: true })

  const w = new PdfWriter(doc, font, fontBold)

  w.baslik('Tahkikat Formu')
  w.satir('Dosya No', detay.dosyaid)
  w.satir('Tarih', detay.tarih)
  w.bosluk(6)

  w.altBaslik('Kişi Bilgileri')
  w.satir('TC Kimlik No', detay.tcKimlikNo || '-')
  w.satir('Ad Soyad', detay.adSoyad || '-')
  w.satir('Telefon', detay.telefon || '-')
  w.satir('Adres', detay.adres || '-')
  w.satir('Personel', detay.personel || '-')
  w.satir('Hane Kişi Sayısı', detay.haneKisiSayisi !== null ? String(detay.haneKisiSayisi) : '-')
  w.bosluk(6)
  w.cizgi()

  if (detay.eliminasyonSonucu === 'RED') {
    w.kutu('ELİMİNASYON: RED', [0.75, 0.1, 0.1])
    w.altBaslik('Red Nedeni')
    w.paragraf(detay.eliminasyonRedNedeni || '-')
    w.bosluk(6)
    w.altBaslik('Kriter Cevapları')
    for (const cevap of detay.cevaplar.filter((c) => c.bolum === 'kriter')) {
      w.satir(cevap.soruMetni, cevapMetni(cevap))
    }
  } else {
    const kararRenk: [number, number, number] = detay.karar ? KARAR_RENKLERI[detay.karar] ?? [0.3, 0.3, 0.3] : [0.3, 0.3, 0.3]
    w.kutu(`Toplam Puan: ${detay.toplamPuan ?? '-'} / ${detay.maksimumPuan}   -   Karar: ${detay.karar ?? '-'}`, kararRenk)

    if (detay.yardimTuruOnerisi) {
      w.altBaslik('Yardım Türü Önerisi')
      w.paragraf(detay.yardimTuruOnerisi)
      w.bosluk(6)
    }

    w.altBaslik('Kriter Cevapları')
    for (const cevap of detay.cevaplar.filter((c) => c.bolum === 'kriter')) {
      w.satir(cevap.soruMetni, cevapMetni(cevap))
    }
    w.bosluk(6)

    w.altBaslik('Değerlendirme Cevapları')
    for (const cevap of detay.cevaplar.filter((c) => c.bolum === 'degerlendirme')) {
      const puanEki = cevap.toplamPuan !== null ? ` (${cevap.toplamPuan} puan)` : ''
      w.satir(cevap.soruMetni, `${cevapMetni(cevap)}${puanEki}`)
    }
    w.bosluk(6)

    const gozlemler = detay.cevaplar.filter((c) => c.bolum === 'gozlem')
    if (gozlemler.length > 0) {
      w.altBaslik('Gözlem')
      for (const cevap of gozlemler) {
        w.satir(cevap.soruMetni, cevapMetni(cevap))
      }
      w.bosluk(6)
    }

    if (detay.digerKurumYardimlari.length > 0) {
      w.altBaslik('Diğer Kurum Yardımları')
      for (const yardim of detay.digerKurumYardimlari) {
        w.paragraf(`${yardim.kurum}${yardim.yardimTuru ? ' - ' + yardim.yardimTuru : ''}${yardim.tutar ? ' - ' + yardim.tutar + ' TL' : ''}`)
      }
      w.bosluk(6)
    }
  }

  w.cizgi()
  w.altBaslik('Onay')
  w.satir('Onay Durumu', detay.onayDurumu)
  w.satir('Onay Notu', detay.onayNotu || '-')

  return doc.save()
}
