import {
  bosMu,
  birlesikRaporUret,
  haneAnalizi,
  haneSutunlari,
  calisabilirMi,
  GELIR_KAYNAGI_METNI,
  imzaDuzeni,
  type HaneAnalizi,
  type CevapDegeri,
  type Cevaplar,
  type Sablon,
  type Soru,
  type TabloSatiri,
} from '@/lib/constants/sahaIncelemeForm'

// Hane Ziyareti ve Sosyal Inceleme Formu'nun yazdirilabilir HTML'i - hem
// doldurulmus kaydin ciktisi hem de sahaya goturulecek BOS form. Kullanicinin
// verdigi PDF'in duzenini izler (baslik bandi, bilgi tablosu, numarali
// bolumler, onay kutulari, tablolar, imza alanlari). Tarayicinin yazdirma
// penceresinden "PDF olarak kaydet" ile PDF de alinabilir.

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function cokSatirli(value: unknown): string {
  return esc(value).replace(/\r?\n/g, '<br>')
}

function kutu(secili: boolean) {
  return `<span class="kutu${secili ? ' secili' : ''}">${secili ? '✓' : ''}</span>`
}

function deger(cevaplar: Cevaplar | null, soru: Soru): CevapDegeri | undefined {
  return cevaplar ? cevaplar[String(soru.id)] : undefined
}

function basitAlan(soru: Soru, cevap: CevapDegeri | undefined, bos: boolean): string {
  // 2026-10-14: bos (sahaya goturulen) formda uzun metin alani, Ayarlar'da
  // verilen yukseklik (satir) kadar yazi cizgisi birakir (en fazla 15).
  if (bos && soru.tur === 'uzun_metin' && soru.yukseklik && soru.yukseklik > 1) {
    return Array.from({ length: Math.min(15, soru.yukseklik) }, () => '<span class="cizgi satir"></span>').join('')
  }
  if (bos || bosMu(soru, cevap)) return `<span class="cizgi${soru.tur === 'uzun_metin' ? ' uzun' : ''}"></span>`
  let metin = String(cevap)
  if (soru.tur === 'tarih_saat') metin = metin.replace('T', ' ')
  if (soru.tur === 'tarih' && /^\d{4}-\d{2}-\d{2}$/.test(metin)) metin = metin.split('-').reverse().join('.')
  if (soru.tur === 'tarih_saat' && /^\d{4}-\d{2}-\d{2} /.test(metin)) {
    const [g, s] = metin.split(' ')
    metin = `${g.split('-').reverse().join('.')} ${s}`
  }
  return `<span class="deger">${cokSatirli(metin)}</span>`
}

function secimAlani(soru: Soru, cevap: CevapDegeri | undefined, bos: boolean): string {
  const secilenler = new Set(bos || cevap === undefined ? [] : Array.isArray(cevap) ? (cevap as string[]) : [cevap as string])
  const sinif = soru.secenekler.length > 3 ? 'secenekler izgara' : 'secenekler satir'
  return `<div class="${sinif}">${soru.secenekler
    .map((s) => `<span class="secenek">${kutu(secilenler.has(s.id))}${esc(s.metin)}</span>`)
    .join('')}</div>`
}

function tabloAlani(soru: Soru, cevap: CevapDegeri | undefined, bos: boolean, hane?: HaneAnalizi | null): string {
  const kayitli = !bos && Array.isArray(cevap) ? (cevap as TabloSatiri[]) : []
  let satirlar: TabloSatiri[]
  if (soru.sabitSatirlar.length > 0) {
    satirlar = soru.sabitSatirlar.map((sabit) => kayitli.find((s) => s.sabit === sabit) ?? { sabit, hucreler: {} })
  } else {
    satirlar = kayitli.filter((s) => Object.values(s.hucreler || {}).some((v) => String(v ?? '').trim() !== ''))
    if (bos || satirlar.length === 0) satirlar = Array.from({ length: Math.max(bos ? soru.bosSatirSayisi : 1, 1) }, () => ({ hucreler: {} }))
  }

  // Hane uyeleri: calisabilecek uyelerin satiri yesil, altta hane ozeti (formdaki gibi)
  const haneTablosu = soru.otomatik === 'hane_uyeleri'
  const hs = haneTablosu ? haneSutunlari(soru) : null
  const baslik = soru.sutunlar.map((s) => `<th>${esc(s.baslik)}</th>`).join('')
  const govde = satirlar.map((satir) => `<tr${hs && !bos && calisabilirMi(satir, hs) ? ' class="calisabilir"' : ''}>${soru.sutunlar.map((sutun, index) => {
    if (index === 0 && satir.sabit) return `<td class="sabit">${esc(satir.sabit)}</td>`
    const hucre = satir.hucreler?.[sutun.id]
    if (hucre !== undefined && String(hucre).trim() !== '') {
      return `<td${sutun.tur === 'sayi' ? ' class="sag"' : ''}>${cokSatirli(hucre)}</td>`
    }
    if (bos && sutun.tur === 'secim' && sutun.secenekler?.length) {
      // Secenekler kendi icinde bolunmez ama hucre icinde alt satira iner (A4'e sigar)
      return `<td class="kucuk">${sutun.secenekler.map((s) => `<span class="sec">${kutu(false)}${esc(s)}</span>`).join(' ')}</td>`
    }
    return '<td>&nbsp;</td>'
  }).join('')}</tr>`).join('')

  let ozet = ''
  if (hane && haneTablosu && !bos) {
    const parcalar = [
      `<span>Hanedeki kişi: <b>${hane.kisiSayisi ? `${hane.kisiSayisi} kişi` : '—'}</b></span>`,
      ...(hane.calisabilecek !== null ? [`<span>Çalışabilecek birey (sağlıklı, 18 yaş ve üzeri): <b>${hane.calisabilecek} kişi</b></span>`] : []),
      `<span>Aylık toplam gelir: <b>${hane.toplamGelir !== null ? esc(tlMetni(hane.toplamGelir)) : '—'}</b></span>`,
      `<span>Kişi başı gelir: <b>${hane.kisiBasi !== null ? esc(tlMetni(Math.round(hane.kisiBasi))) : '—'}</b></span>`,
    ]
    const kaynak = hane.toplamGelir !== null && hane.gelirKaynagi ? `<span class="kaynak">Gelir kaynağı: ${esc(GELIR_KAYNAGI_METNI[hane.gelirKaynagi])}</span>` : ''
    ozet = `<div class="hane-ozet">${parcalar.join('')}${kaynak}</div>`
  }

  return `<table class="veri${haneTablosu ? ' hane' : ''}"><thead><tr>${baslik}</tr></thead><tbody>${govde}</tbody></table>${ozet}`
}

function tlMetni(n: number): string {
  return `${n.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} TL`
}

function soruHtml(soru: Soru, cevaplar: Cevaplar | null, bos: boolean, hane?: HaneAnalizi | null): string {
  const cevap = deger(cevaplar, soru)
  const ipucu = soru.ipucu ? ` <span class="ipucu">(${esc(soru.ipucu)})</span>` : ''
  if (soru.tur === 'tablo') {
    return `<div class="tablo-soru"><div class="etiket">${esc(soru.soruMetni)}${ipucu}</div>${tabloAlani(soru, cevap, bos, hane)}</div>`
  }
  if (soru.tur === 'imza') {
    const resim = !bos && typeof cevap === 'string' && cevap.startsWith('data:image/png;base64,')
      ? `<img class="imza-img" src="${esc(cevap)}" alt="İmza">`
      : ''
    return `<tr class="imza-satir"><th>${esc(soru.soruMetni)}${ipucu}</th><td><div class="imza-kutu">${resim}</div></td></tr>`
  }
  const alan = soru.tur === 'tek' || soru.tur === 'coklu' ? secimAlani(soru, cevap, bos) : basitAlan(soru, cevap, bos)
  const genis = soru.tur === 'uzun_metin' || ((soru.tur === 'tek' || soru.tur === 'coklu') && soru.secenekler.length > 3)
  return `<tr class="${genis ? 'genis' : ''}"><th>${esc(soru.soruMetni)}${ipucu}</th><td>${alan}</td></tr>`
}

export type YazdirSecenekleri = {
  sablon: Sablon
  cevaplar: Cevaplar | null
  formNo?: string | null
  dosyaNo?: string | null
  tarih?: string | null
  otomatikYazdir?: boolean
  personelAciklamasi?: string | null
  personelRaporu?: string | null
}

export function sahaIncelemeHtml({ sablon, cevaplar, formNo, dosyaNo, tarih, otomatikYazdir, personelAciklamasi, personelRaporu }: YazdirSecenekleri): string {
  const bos = cevaplar === null
  const a = sablon.ayarlar
  const bolumler = sablon.bolumler.filter((b) => b.aktif !== false)
  const sonNotBolumIndex = bolumler.findIndex((b) => b.sorular.some((s) => s.anahtar === 'on_degerlendirme'))
  // Sablonda dokunmatik imza sorusu varsa sondaki genel imza kutulari tekrarlanmaz.
  const imzaSorusuVar = bolumler.some((b) => b.sorular.some((s) => s.tur === 'imza' && s.aktif !== false))
  const tarihMetni = tarih && /^\d{4}-\d{2}-\d{2}/.test(tarih) ? tarih.slice(0, 10).split('-').reverse().join('.') : (tarih || '')
  // Formdaki ve ozet rapordaki ile ayni hane hesabi
  const hane = !bos && cevaplar ? haneAnalizi({ ...sablon, bolumler }, cevaplar) : null

  const bolumHtml = bolumler.map((bolum, index) => {
    const tumu = bolum.sorular.filter((s) => s.aktif !== false)
    // Imzalar yan yana (solda basvuru sahibi, sagda personel; personel adi
    // personel imzasinin ustunde) - formdaki duzenle ayni.
    // 2026-10-15: birden fazla personel imzasi (ortak duzen: imzaDuzeni).
    const duzen = imzaDuzeni(tumu)
    const sorular = duzen.satirlar
    const imzaSirasi = duzen.siraliImzalar
    const imzaHucre = (s: Soru) => {
      const c = deger(cevaplar, s)
      const resim = !bos && typeof c === 'string' && c.startsWith('data:image/png;base64,') ? `<img class="imza-img" src="${esc(c)}" alt="İmza">` : ''
      const personelAd = duzen.adSorusu(s)
      const ad = personelAd
        ? `<div class="imza-ad">${esc(personelAd.soruMetni)}: <b>${esc(bos ? '' : String(deger(cevaplar, personelAd) ?? ''))}</b></div>`
        : ''
      return `<td class="${duzen.personelImzasiMi(s) ? 'personel' : 'basvuru'}"><div class="imza-baslik">${esc(s.soruMetni)}</div>${ad}<div class="imza-kutu">${resim}</div></td>`
    }
    const imzaHtml = imzaSirasi.length ? `<table class="imzalar-yan"><tr>${imzaSirasi.map(imzaHucre).join('')}</tr></table>` : ''
    // Ardisik basit sorulari tek bir iki kolonlu tabloda topla; tablo
    // sorularini ayri blok olarak arada goster (PDF'teki gibi).
    const parcalar: string[] = []
    let acikTablo: string[] = []
    const kapat = () => {
      if (acikTablo.length) parcalar.push(`<table class="alanlar">${acikTablo.join('')}</table>`)
      acikTablo = []
    }
    for (const soru of sorular) {
      if (soru.tur === 'tablo') {
        kapat()
        parcalar.push(soruHtml(soru, cevaplar, bos, hane))
      } else {
        acikTablo.push(soruHtml(soru, cevaplar, bos))
      }
    }
    kapat()
    const sonNot = index === sonNotBolumIndex && a.sonNot ? `<p class="son-not">${cokSatirli(a.sonNot)}</p>` : ''
    return `
      <section class="bolum">
        <h2>${index + 1}. ${esc(bolum.baslik.toLocaleUpperCase('tr-TR'))}</h2>
        ${bolum.aciklama ? `<p class="aciklama">${cokSatirli(bolum.aciklama)}</p>` : ''}
        ${parcalar.join('')}
        ${imzaHtml}
        ${sonNot}
      </section>`
  }).join('')

  const sonNotSonda = sonNotBolumIndex < 0 && a.sonNot ? `<p class="son-not">${cokSatirli(a.sonNot)}</p>` : ''

  // Kullanici karari (2026-10-13, "B secenegi"): doldurulmus formun ciktisinda
  // ayri "Sosyal Inceleme Ozet Raporu" (gostergeler + otomatik ozet + personel
  // raporu) bolumu ARTIK BASILMAZ - ayni bilgiler zaten Birlestirilmis Tahkikat
  // Raporu'nda (personel degerlendirmesi dahil) yer aliyor; ciktida tekrar olmasin.
  // Kayitta birlesik rapor yoksa (eski kayit) ayni metin anlik uretilir.
  const raporHtml = ''
  const birlesikMetin = !bos && cevaplar
    ? (personelAciklamasi?.trim()
      || birlesikRaporUret({ sablon: { ...sablon, bolumler }, cevaplar, personelRaporu: personelRaporu ?? '', dosyaEtiketi: dosyaNo, tarih: tarihMetni }))
    : ''
  // Bos formda: tahkikat gorevlisinin elle yazacagi bos alan.
  const aciklamaHtml = `
      <section class="gorevli">
        <div class="gorevli-bas">${bos ? 'TAHKİKAT GÖREVLİSİNİN RAPORU' : 'BİRLEŞTİRİLMİŞ TAHKİKAT RAPORU'}</div>
        ${!bos && birlesikMetin ? `<div class="birlesik">${cokSatirli(birlesikMetin)}</div>` : '<span class="cizgi uzun"></span><span class="cizgi uzun"></span><span class="cizgi uzun"></span>'}
      </section>`

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<title>${esc(a.formBasligi)}${formNo ? ` - Form No ${esc(formNo)}` : ''}</title>
<style>
  @page { size: A4; margin: 14mm 13mm 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, "Segoe UI", sans-serif; font-size: 10.5px; color: #111; background: #e5e7eb; }
  .sayfa { width: 210mm; min-height: 297mm; margin: 12px auto; background: #fff; padding: 14mm 13mm 18mm; box-shadow: 0 2px 12px rgba(0,0,0,.18); }
  .arac { position: sticky; top: 0; z-index: 5; display: flex; justify-content: center; gap: 8px; padding: 8px; background: #0f2a52; }
  .arac button { border: 0; border-radius: 6px; padding: 7px 16px; font-weight: 700; font-size: 13px; cursor: pointer; background: #fff; color: #0f2a52; }
  .kurum { text-align: center; font-weight: 700; font-size: 12.5px; letter-spacing: .02em; }
  h1 { text-align: center; color: #2f5496; font-size: 17px; margin: 6px 0 4px; padding-bottom: 6px; border-bottom: 1.5px solid #2f5496; }
  .alt-baslik { text-align: center; font-style: italic; margin: 6px 0 10px; }
  table { border-collapse: collapse; width: 100%; }
  .bilgi td { border: 1px solid #555; padding: 3px 6px; }
  .bilgi td.e { width: 18%; font-weight: 700; background: #f3f4f6; }
  .not { margin: 10px 0 4px; line-height: 1.45; text-align: justify; }
  .bolum { margin-top: 14px; break-inside: auto; }
  .bolum h2 { color: #2f5496; font-size: 13px; margin: 0 0 6px; break-after: avoid; }
  .aciklama { font-style: italic; margin: 0 0 6px; line-height: 1.4; }
  .alanlar { margin-bottom: 6px; }
  .alanlar th, .alanlar td { border: 1px solid #555; padding: 3px 6px; vertical-align: top; text-align: left; }
  .alanlar th { width: 46%; font-weight: 400; background: #fafafa; }
  .alanlar tr.genis th { width: 30%; }
  .alanlar tr { break-inside: avoid; }
  .veri { margin: 3px 0 8px; }
  .veri th { background: #dbe5f1; border: 1px solid #555; padding: 3px 5px; text-align: left; font-size: 10px; }
  .veri td { border: 1px solid #555; padding: 3px 5px; height: 20px; vertical-align: top; }
  .veri td.sabit { background: #fafafa; }
  .veri td.sag { text-align: right; }
  .veri td.kucuk { font-size: 9px; line-height: 1.5; }
  .veri td.kucuk .sec { white-space: nowrap; display: inline-block; margin-right: 4px; }
  .veri.hane th, .veri.hane td { font-size: 9.5px; padding: 2px 4px; }
  .veri tr.calisabilir td { background: #dcfce7; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .hane-ozet { display: flex; flex-wrap: wrap; gap: 3px 14px; margin: -4px 0 8px; padding: 4px 6px; border: 1px solid #555; border-top: 0; background: #f3f6fa; font-size: 9.5px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .hane-ozet .kaynak { flex-basis: 100%; font-style: italic; color: #555; }
  .veri tr { break-inside: avoid; }
  .etiket { font-weight: 700; margin-top: 4px; }
  .ipucu { font-style: italic; color: #555; font-weight: 400; }
  .cizgi { display: block; border-bottom: 1px solid #333; height: 15px; }
  .cizgi.uzun { height: 34px; }
  .cizgi.satir { height: 26px; }
  .deger { font-weight: 700; }
  .secenekler.izgara { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 14px; }
  .secenekler.satir { display: flex; flex-wrap: wrap; gap: 3px 14px; }
  .secenek { display: inline-flex; align-items: center; gap: 4px; }
  .kutu { display: inline-flex; align-items: center; justify-content: center; width: 11px; height: 11px; border: 1px solid #222; font-size: 9px; line-height: 1; flex-shrink: 0; }
  .kutu.secili { background: #1f2937; color: #fff; font-weight: 700; }
  .son-not { font-weight: 700; margin: 6px 0 0; line-height: 1.4; }
  .imzalar { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 18px; break-inside: avoid; }
  .imza { border: 1px solid #555; padding: 5px 6px; height: 70px; }
  .imza b { display: block; font-size: 9.5px; }
  .imza-not { font-size: 9px; font-style: italic; margin-top: 4px; }
  .alt-bilgi { text-align: center; font-size: 8.5px; color: #777; margin-top: 16px; }
  .rapor { margin-top: 18px; border: 1.5px solid #2f5496; break-inside: auto; }
  .rapor-bas { margin: 0; padding: 6px 10px; background: #2f5496; color: #fff; font-size: 12.5px; letter-spacing: .04em; }
  .gostergeler { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; border-bottom: 1px solid #c9d4e3; }
  .gosterge { padding: 5px 8px; border-right: 1px solid #e3e9f1; border-bottom: 1px solid #e3e9f1; }
  .gosterge span { display: block; font-size: 8.5px; text-transform: uppercase; color: #555; }
  .gosterge b { font-size: 11px; }
  .gosterge.kirmizi b { color: #b91c1c; } .gosterge.amber b { color: #92400e; } .gosterge.yesil b { color: #065f46; }
  .rapor-metin { margin: 0; padding: 8px 10px; line-height: 1.55; text-align: justify; border-bottom: 1px solid #e3e9f1; }
  .bulgular th { text-align: left; background: #eef3f9; padding: 3px 8px; font-size: 10px; border-top: 1px solid #c9d4e3; }
  .bulgular td { padding: 2px 8px; border-top: 1px solid #f0f3f7; vertical-align: top; }
  .bulgular td:first-child { width: 42%; color: #444; }
  .bulgular tr { break-inside: avoid; }
  .imzalar-yan { margin-top: 6px; table-layout: fixed; break-inside: avoid; }
  .imzalar-yan td { border: 1px solid #555; padding: 6px 8px; vertical-align: top; }
  .imzalar-yan td.basvuru { background: #f0faf8; }
  .imzalar-yan td.personel { background: #f0f4fd; }
  .imzalar-yan .imza-baslik { font-weight: 700; margin-bottom: 4px; }
  .imzalar-yan .imza-ad { margin-bottom: 4px; }
  .imzalar-yan .imza-kutu { max-width: none; height: 80px; background: #fff; }
  .imzalar-yan .imza-img { max-height: 76px; }
  .imza-satir th { vertical-align: middle; }
  .imza-kutu { height: 62px; border: 1px dashed #888; display: flex; align-items: center; justify-content: center; max-width: 260px; }
  .imza-img { max-height: 58px; max-width: 100%; }
  .gorevli { margin-top: 10px; border: 1px solid #555; padding: 6px 10px; break-inside: avoid; }
  .gorevli-bas { font-weight: 700; color: #2f5496; font-size: 11px; margin-bottom: 4px; }
  .gorevli p { margin: 0; line-height: 1.5; }
  .gorevli .birlesik { line-height: 1.55; text-align: justify; }
  .bulgular.iki td { width: 50%; vertical-align: top; padding: 6px 8px; border-right: 1px solid #e3e9f1; }
  .bulgular.iki td:last-child { border-right: 0; }
  .bulgular.iki p { margin: 0 0 4px; line-height: 1.45; text-align: justify; }
  .kutu-bas { font-weight: 700; font-size: 9.5px; color: #2f5496; margin-bottom: 4px; letter-spacing: .04em; }
  .rapor-dip { margin: 0; padding: 5px 10px; font-size: 9px; font-style: italic; color: #666; background: #f8fafc; }
  @media print {
    body { background: #fff; }
    .arac { display: none; }
    .sayfa { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
    .alt-bilgi { position: fixed; bottom: -10mm; left: 0; right: 0; margin: 0; }
  }
</style>
</head>
<body>
  <div class="arac"><button type="button" onclick="window.print()">Yazdır / PDF olarak kaydet</button><button type="button" onclick="window.close()">Kapat</button></div>
  <div class="sayfa">
    ${a.kurumBasligi ? `<div class="kurum">${esc(a.kurumBasligi)}</div>` : ''}
    <h1>${esc(a.formBasligi)}</h1>
    ${a.altBaslik ? `<div class="alt-baslik">${esc(a.altBaslik)}</div>` : ''}
    <table class="bilgi">
      <tr><td class="e">Form No:</td><td>${esc(formNo || '')}</td><td class="e">Sürüm/Tarih:</td><td>${esc(a.surum)}</td></tr>
      <tr><td class="e">Başvuru No:</td><td>${esc(dosyaNo || '')}</td><td class="e">Kayıt tarihi:</td><td>${esc(tarihMetni)}</td></tr>
    </table>
    ${a.kullanimNotu ? `<p class="not"><b>KULLANIM NOTU:</b> ${cokSatirli(a.kullanimNotu)}</p>` : ''}
    ${bolumHtml}
    ${sonNotSonda}
    ${raporHtml}
    ${aciklamaHtml}
    ${imzaSorusuVar ? '' : `<div class="imzalar">
      <div class="imza"><b>Personel adı-soyadı / imza</b></div>
      <div class="imza"><b>İkinci personel (varsa) / imza</b></div>
      <div class="imza"><b>Başvuru sahibi / görüşülen kişi imzası</b></div>
    </div>
    <p class="imza-not">Başvuru sahibi imzası yalnızca görüşmeye katılım veya teslim alındı kaydı içindir.</p>`}
    ${a.altBilgi ? `<div class="alt-bilgi">${esc(a.altBilgi)}</div>` : ''}
  </div>
  ${otomatikYazdir ? '<script>window.addEventListener("load", function () { setTimeout(function () { window.print() }, 300) })</script>' : ''}
</body>
</html>`
}
