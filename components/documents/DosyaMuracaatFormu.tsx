'use client'

import { useLayoutEffect, useRef, useState } from 'react'

// Dosya Müracaat Formu (Sosyal Yardım Talep Formu) - kurumsal A4 cikti
// (kullanici istegi 2026-10-14: "daha profesyonel ve kurumsal yapalim,
// müracaatçının dijital imzasini alip kaydedebilelim"). Eski, tasarimcida
// mutlak konumlu kutularla cizilmis "07 - DOSYA MÜRACAAT FORMU" (tasma/ust
// uste binme sorunlari) yerine kodla, akan duzende cizilir.
//
// ONEMLI: Bu bilesenin HTML'i (innerHTML) yerel yazdirma agent'ina
// gonderilir ve orada Tailwind YOKTUR - bu yuzden tum stiller asagidaki
// gomulu <style> blogunda, ".dmf" ile kapsamlanmis olarak durur.

export const MURACAAT_TALEP_SECENEKLERI = ['Ekmek', 'Gıda', 'Hazır Yemek', 'Giyim', 'Yakacak (Odun)'] as const

export type MuracaatHaneSatiri = {
  sequence: string
  relation: string
  identityNumber: string
  fullName: string
  birthDate: string
  maritalStatus: string
}

type Kisi = Record<string, string | undefined | null>

type Props = {
  kisi: Kisi
  dosyaNo: string
  adres: string
  hane: MuracaatHaneSatiri[]
  imza: string | null
  personelImza: string | null
  // Müracaatçının el yazısıyla "Okudum, onaylıyorum." (dijital alinmissa)
  onayYazisi: string | null
  imzaTarihi: string
  personel: string
  logoSrc: string
  fotoSrc: string
}

function deger(value: string | undefined | null): string {
  const text = String(value ?? '').trim()
  return text && text !== '-' && text !== 'undefined' && text !== 'null' ? text : ''
}

// Kullanici istegi (2026-10-14): "form her zaman tek sayfaya sigsin" -
// sayfa yuksekligi SABIT (296mm: tam 297mm bazi yazicilarda yuvarlama
// nedeniyle bos 2. sayfa uretir) + overflow hidden. Icerik (.dmf-ic) buna
// sigmazsa once hane satir sayisina gore sikistirilir (dmf-sik/dmf-cok-sik),
// yine sigmazsa olculup transform: scale ile orantili kucultulur (bkz.
// useLayoutEffect). Olcek inline style oldugu icin innerHTML ile yazdirma
// agent'ina / PDF'e de AYNEN gider (PDF tarafinda JS kapali olsa bile).
const STIL = `
.dmf { width: 210mm; height: 296mm; overflow: hidden; padding: 9mm 12mm 8mm; background: #fff; color: #111827; font-family: Arial, "Helvetica Neue", Helvetica, sans-serif; font-size: 9.5pt; line-height: 1.35; text-align: left; letter-spacing: 0; box-sizing: border-box; page-break-inside: avoid; break-inside: avoid; }
.dmf * { box-sizing: border-box; }
/* GECE MODU YALITIMI (2026-10-15, hata raporu: "gece modunda mobilde sorun"):
   uygulamanin .dark kurallari (ör. ".dark table td" koyu text-shadow) formun
   hucrelerine de siziyor, beyaz kagitta yazilari bulanik/kirli gosteriyordu.
   Form her zaman gunduz gorunumunde cizilir. */
.dmf { color-scheme: light; }
.dmf, .dmf * { text-shadow: none !important; }
.dmf .dmf-ic { transform-origin: top center; }
.dmf.dmf-sik .dmf-hane td { padding: .5mm 2mm; font-size: 8.8pt; }
.dmf.dmf-sik .dmf-beyan { font-size: 8.6pt; line-height: 1.32; }
.dmf.dmf-cok-sik .dmf-hane td { padding: .25mm 2mm; font-size: 8pt; }
.dmf.dmf-cok-sik .dmf-hane th { padding: .6mm 2mm; }
.dmf.dmf-cok-sik .dmf-beyan { font-size: 8.1pt; line-height: 1.28; padding: 1.4mm 3mm; }
.dmf.dmf-cok-sik .dmf-bolum { margin-bottom: 2mm; }
.dmf.dmf-cok-sik .dmf-imza .alan { height: 12mm; }
/* Dosya Yönetimi'nin genel yazi olcegi kurallari (.dy-base-16 div/span/td...)
   formu buyutmesin: her oge boyutunu .dmf'den / kendi sinifindan alir. */
.dmf div, .dmf span, .dmf b, .dmf p, .dmf td, .dmf th, .dmf label, .dmf strong, .dmf h1 { font-family: inherit; font-size: inherit; }
/* IE11 UYUMU (2026-10-14): yazdirma agent'i HTML'i Windows WebBrowser (IE11)
   motoruyla cizer - CSS grid YOK, flex 'gap' YOK, object-fit YOK. Bu yuzden
   yan yana yerlesimler TABLO ile, dikey hizalamalar line-height ile yapilir
   (Chrome/PDF'te de birebir ayni gorunur). */
.dmf table.dmf-ust { width: 100%; border-collapse: collapse; border-bottom: 2.2pt solid #0f2a52; }
.dmf table.dmf-ust > tbody > tr > td { padding: 0 0 3mm; vertical-align: middle; border: 0; }
.dmf table.dmf-ust > tbody > tr > td.u-logo { width: 24mm; }
.dmf table.dmf-ust > tbody > tr > td.u-kutu { width: 50mm; }
.dmf .dmf-logo { width: 20mm; height: 20mm; display: block; }
.dmf .dmf-kurum { text-align: center; line-height: 1.3; }
.dmf .dmf-kurum .tc { font-size: 9.5pt; font-weight: 700; letter-spacing: .5pt; }
.dmf .dmf-kurum .bel { font-size: 14pt; font-weight: 800; color: #0f2a52; letter-spacing: .4pt; }
.dmf .dmf-kurum .mud { font-size: 10pt; font-weight: 700; color: #334155; }
.dmf .dmf-kurum .form-adi { margin-top: .8mm; font-size: 13pt; font-weight: 800; letter-spacing: 1.4pt; color: #0f2a52; }
.dmf .dmf-kutu { border: .9pt solid #0f2a52; border-radius: 1.5mm; overflow: hidden; font-size: 8.5pt; }
.dmf .dmf-kutu table { width: 100%; border-collapse: collapse; }
.dmf .dmf-kutu td { padding: 1.2mm 2.4mm; white-space: nowrap; vertical-align: middle; border: 0; }
.dmf .dmf-kutu tr + tr td { border-top: .6pt solid #cbd5e1; }
.dmf .dmf-kutu td.sag { text-align: right; }
.dmf .dmf-kutu b { color: #0f2a52; }
.dmf .dmf-kutu .no { font-size: 11.5pt; font-weight: 800; letter-spacing: .5pt; }
.dmf .dmf-serit { height: 1.1mm; background: #b8860b; margin: .7mm 0 2.5mm; font-size: 0; line-height: 0; }
.dmf .dmf-bolum { margin-bottom: 3mm; }
.dmf .dmf-bolum-bas { display: block; background: #0f2a52; color: #fff; font-size: 9pt; font-weight: 700; letter-spacing: .6pt; padding: 1.2mm 3mm; border-radius: 1.5mm 1.5mm 0 0; line-height: 4.6mm; }
.dmf .dmf-bolum-bas span { display: inline-block; width: 4.6mm; height: 4.6mm; line-height: 4.6mm; margin-right: 2mm; text-align: center; vertical-align: top; border-radius: 50%; background: #fff; color: #0f2a52; font-size: 8pt; letter-spacing: 0; }
.dmf .dmf-bolum-govde { border: .8pt solid #94a3b8; border-top: 0; border-radius: 0 0 1.5mm 1.5mm; }
.dmf table { width: 100%; border-collapse: collapse; }
.dmf table.dmf-kisi td.k-bilgi { padding: 0; vertical-align: top; border: 0; }
.dmf table.dmf-kisi td.dmf-foto { width: 33mm; padding: 2mm; vertical-align: middle; text-align: center; border: 0; border-left: .8pt solid #94a3b8; }
.dmf .dmf-bilgi td { padding: 1.2mm 2.4mm; border-bottom: .5pt solid #e2e8f0; vertical-align: top; }
.dmf .dmf-bilgi tr:last-child td { border-bottom: 0; }
.dmf .dmf-bilgi td.e { width: 32mm; font-weight: 700; color: #334155; background: #f1f5f9; font-size: 8.2pt; text-transform: uppercase; letter-spacing: .2pt; }
.dmf .dmf-bilgi td.d { font-weight: 700; font-size: 10pt; }
.dmf .dmf-bilgi td.e2 { width: 25mm; }
/* Fotograf: object-fit IE'de yok -> sabit kutu icinde max-width/max-height ile
   oran korunarak ortalanir (IE/Chrome/PDF ayni; <img> kalir ki PDF data URL'e cevirebilsin). */
.dmf .dmf-foto .resim { width: 27mm; height: 34mm; line-height: 33mm; margin: 0 auto; border: .6pt solid #94a3b8; background: #f8fafc; text-align: center; overflow: hidden; }
.dmf .dmf-foto .resim img { max-width: 100%; max-height: 100%; vertical-align: middle; }
.dmf .dmf-foto .bos { width: 27mm; height: 34mm; line-height: 34mm; margin: 0 auto; border: .8pt dashed #94a3b8; text-align: center; font-size: 7.5pt; color: #94a3b8; }
.dmf .dmf-hane th { background: #e8eef7; color: #0f2a52; font-size: 8pt; font-weight: 700; text-align: left; padding: 1.1mm 2mm; border-bottom: .8pt solid #94a3b8; text-transform: uppercase; }
.dmf .dmf-hane td { padding: 1mm 2mm; border-bottom: .5pt solid #e2e8f0; font-size: 9.3pt; font-weight: 400; }
.dmf .dmf-hane tr:nth-child(even) td { background: #f8fafc; }
.dmf .dmf-hane tr:last-child td { border-bottom: 0; }
.dmf .dmf-hane .no { width: 9mm; text-align: center; }
.dmf .dmf-hane .bos { text-align: center; color: #64748b; font-style: italic; padding: 3mm; }
.dmf .dmf-beyan { padding: 2mm 3.4mm; text-align: justify; font-size: 9pt; line-height: 1.38; }
.dmf .dmf-beyan p { margin: 0 0 1.3mm; text-indent: 7mm; }
.dmf .dmf-beyan p.onay { text-indent: 0; font-weight: 700; margin-bottom: 0; color: #0f2a52; }
.dmf table.dmf-onay { width: 100%; border-collapse: collapse; margin: 0 0 2.6mm; }
.dmf table.dmf-onay td { padding: 0 1mm; border: 0; vertical-align: bottom; }
.dmf table.dmf-onay td.o-etiket { width: 1%; white-space: nowrap; font-size: 9pt; font-weight: 700; color: #0f2a52; padding-bottom: .6mm; }
.dmf table.dmf-onay td.cizgi { height: 10mm; line-height: 9.6mm; border-bottom: .8pt dotted #475569; overflow: hidden; }
.dmf table.dmf-onay td.cizgi img { max-height: 9.6mm; max-width: 100%; vertical-align: bottom; }
.dmf table.dmf-imzalar { width: 100%; border-collapse: collapse; margin-top: .5mm; }
.dmf table.dmf-imzalar td.i-hucre { width: 50%; padding: 0; vertical-align: top; border: 0; }
.dmf table.dmf-imzalar td.i-sol { padding-right: 2mm; }
.dmf table.dmf-imzalar td.i-sag { padding-left: 2mm; }
.dmf .dmf-imza { border: .8pt solid #94a3b8; border-radius: 1.5mm; padding: 2mm 3mm; }
.dmf .dmf-imza .bas { font-size: 8.3pt; font-weight: 800; color: #0f2a52; letter-spacing: .5pt; text-transform: uppercase; border-bottom: .6pt solid #e2e8f0; padding-bottom: 1mm; margin-bottom: 1.4mm; }
.dmf .dmf-imza .sat { display: block; font-size: 9.3pt; margin-bottom: .8mm; }
.dmf .dmf-imza .sat b { display: inline-block; width: 21mm; color: #334155; }
.dmf .dmf-imza .alan { height: 15mm; line-height: 14.5mm; text-align: center; border-bottom: .8pt dotted #64748b; margin-top: 1mm; overflow: hidden; }
.dmf .dmf-imza .alan img { max-height: 14.5mm; max-width: 100%; vertical-align: bottom; }
.dmf .dmf-imza .dijital { margin-top: .6mm; font-size: 7.5pt; color: #64748b; text-align: center; }
`

export default function DosyaMuracaatFormu({ kisi, dosyaNo, adres, hane, imza, personelImza, onayYazisi, imzaTarihi, personel, logoSrc, fotoSrc }: Props) {
  const sayfaRef = useRef<HTMLDivElement>(null)
  const icRef = useRef<HTMLDivElement>(null)
  const [olcek, setOlcek] = useState(1)
  // Hane kalabaliksa once satirlar sikistirilir (yazi okunur kalir).
  const yogunluk = hane.length > 12 ? 'dmf-cok-sik' : hane.length > 8 ? 'dmf-sik' : ''

  // Son guvence: icerik yine de sayfaya sigmiyorsa orantili kucult.
  // offsetHeight transform'dan etkilenmez -> olcum dongusu olusmaz.
  useLayoutEffect(() => {
    const sayfa = sayfaRef.current
    const ic = icRef.current
    if (!sayfa || !ic) return
    const olc = () => {
      const stil = window.getComputedStyle(sayfa)
      const kullanilabilir = sayfa.clientHeight - parseFloat(stil.paddingTop) - parseFloat(stil.paddingBottom)
      const icerik = ic.offsetHeight
      const yeni = icerik > kullanilabilir && icerik > 0 ? Math.max(0.6, Math.floor((kullanilabilir / icerik) * 1000) / 1000) : 1
      setOlcek((onceki) => (Math.abs(onceki - yeni) > 0.001 ? yeni : onceki))
    }
    olc()
    // Fotograf/imza gorselleri yuklenince yukseklik degisebilir.
    const gozlemci = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(olc) : null
    gozlemci?.observe(ic)
    return () => gozlemci?.disconnect()
  }, [hane, imza, personelImza, onayYazisi, adres, fotoSrc, yogunluk])

  const adSoyad = deger(kisi.ad_soyad)
  const dogumYeriTarihi = [deger(kisi.dogum_yeri), deger(kisi.dogum_tarihi)].filter(Boolean).join(' / ')
  const satir = (etiket: string, value: string, etiket2?: string, value2?: string) => (
    <tr>
      <td className="e">{etiket}</td>
      <td className="d" colSpan={etiket2 ? 1 : 3}>{value || '—'}</td>
      {etiket2 && <><td className="e e2">{etiket2}</td><td className="d">{value2 || '—'}</td></>}
    </tr>
  )

  return (
    <div ref={sayfaRef} className={`dmf${yogunluk ? ` ${yogunluk}` : ''}`}>
      <style dangerouslySetInnerHTML={{ __html: STIL }} />
      <div ref={icRef} className="dmf-ic" style={olcek < 1 ? { transform: `scale(${olcek})` } : undefined}>

      {/* Kullanici istegi (2026-10-14): form adi ayri bir baslik bandi
          yerine kurum blogunun icinde (gorseldeki gibi) - cizgi ile 1.
          bolum arasindaki bosluk kapandi. */}
      <table className="dmf-ust">
        <tbody>
          <tr>
            <td className="u-logo">{logoSrc ? <img className="dmf-logo" src={logoSrc} alt="" /> : null}</td>
            <td className="dmf-kurum">
              <div className="tc">T.C.</div>
              <div className="bel">SİVAS BELEDİYESİ</div>
              <div className="mud">Sosyal Hizmetler Müdürlüğü</div>
              <div className="form-adi">SOSYAL YARDIM TALEP FORMU</div>
            </td>
            <td className="u-kutu">
              <div className="dmf-kutu">
                <table>
                  <tbody>
                    <tr><td><b>DOSYA NO</b></td><td className="sag"><span className="no">{dosyaNo || '—'}</span></td></tr>
                    <tr><td><b>TARİH</b></td><td className="sag">{imzaTarihi}</td></tr>
                  </tbody>
                </table>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div className="dmf-serit" />

      <div className="dmf-bolum">
        <div className="dmf-bolum-bas"><span>1</span>MÜRACAATÇI BİLGİLERİ</div>
        <div className="dmf-bolum-govde">
          <table className="dmf-kisi">
            <tbody>
              <tr>
                <td className="k-bilgi">
                  <table className="dmf-bilgi">
                    <tbody>
                      {satir('T.C. Kimlik No', deger(kisi.tc))}
                      {satir('Adı Soyadı', adSoyad)}
                      {satir('Baba Adı', deger(kisi.baba_adi), 'Anne Adı', deger(kisi.ana_adi))}
                      {satir('Doğum Yeri / Tarihi', dogumYeriTarihi)}
                      {satir('Medeni Hali', deger(kisi.medeni_hal), 'Telefon', deger(kisi.telefon))}
                      {satir('Adres', adres)}
                    </tbody>
                  </table>
                </td>
                <td className="dmf-foto">
                  {fotoSrc ? <div className="resim"><img src={fotoSrc} alt="" /></div> : <div className="bos">Fotoğraf</div>}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="dmf-bolum">
        <div className="dmf-bolum-bas"><span>2</span>MÜRACAATÇININ HANESİNDE BİRLİKTE YAŞADIĞI KİŞİLER</div>
        <div className="dmf-bolum-govde">
          <table className="dmf-hane">
            <thead>
              <tr><th className="no">S.No</th><th>Yakınlığı</th><th>T.C. Kimlik No</th><th>Adı Soyadı</th><th>Doğum Tarihi</th><th>Medeni Hali</th></tr>
            </thead>
            <tbody>
              {hane.length === 0 ? (
                <tr><td colSpan={6} className="bos">Hanede kayıtlı başka birey bulunmamaktadır.</td></tr>
              ) : hane.map((uye) => (
                <tr key={`${uye.sequence}-${uye.identityNumber}`}>
                  <td className="no">{uye.sequence}</td>
                  <td>{deger(uye.relation) || '—'}</td>
                  <td>{deger(uye.identityNumber) || '—'}</td>
                  <td>{deger(uye.fullName) || '—'}</td>
                  <td>{deger(uye.birthDate) || '—'}</td>
                  <td>{deger(uye.maritalStatus) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="dmf-bolum">
        <div className="dmf-bolum-bas"><span>3</span>BEYAN VE AÇIK RIZA</div>
        <div className="dmf-bolum-govde dmf-beyan">
          <p>Belediyeniz tarafından muhtaç ailelere yapılan sosyal yardımlardan yararlanmak istiyorum. İşbu başvuruda beyan ettiğim bilgilerin doğru olduğunu ve bunların doğruluğunun tespiti için Kurumunuzun şahsım ve tüm aile bireylerim hakkında fiziksel ve elektronik ortamda her türlü araştırmayı yapmasını kabul ediyorum.</p>
          <p>Ayrıca sosyal yardım yapan resmi kurum ve sivil toplum kuruluşlarından bilgi alınmasına, paylaşılmasına, taşınır ve taşınmaz mal varlığımın araştırılmasına, gerekirse bana ait ev, işyeri ve diğer mekânlarıma girilerek inceleme yapılmasına izin verdiğimi beyan ediyorum.</p>
          <p>6698 Sayılı Kişisel Verilerin Korunması Kanunu kapsamında tarafıma elektronik posta, telefon vb. iletişim kanalları vasıtasıyla ses ve görüntü içerikli bilgilendirme iletileri gönderilmesine ve kişisel verilerimin bu amaçla işlenmesine onay veriyorum.</p>
          <p className="onay">Yukarıdaki hususlar hakkında Kurum tarafından tarafıma bilgilendirme yapıldığını kabul ediyorum.</p>
        </div>
      </div>

      <table className="dmf-onay">
        <tbody>
          <tr>
            <td className="o-etiket">Müracaatçının kendi el yazısıyla “Okudum, onaylıyorum.”:</td>
            <td className="cizgi">{onayYazisi ? <img src={onayYazisi} alt="" /> : null}</td>
          </tr>
        </tbody>
      </table>

      <table className="dmf-imzalar">
        <tbody>
          <tr>
            <td className="i-hucre i-sol">
              <div className="dmf-imza">
                <div className="bas">Müracaatçı</div>
                <div className="sat"><b>Adı Soyadı</b><span>{adSoyad || '—'}</span></div>
                <div className="sat"><b>Tarih</b><span>{imzaTarihi}</span></div>
                <div className="alan">{imza ? <img src={imza} alt="" /> : null}</div>
                <div className="dijital">{imza ? 'Dijital olarak imzalanmıştır' : 'İmza'}</div>
              </div>
            </td>
            <td className="i-hucre i-sag">
              <div className="dmf-imza">
                <div className="bas">Formu Teslim Alan Personel</div>
                <div className="sat"><b>Adı Soyadı</b><span>{personel || '—'}</span></div>
                <div className="sat"><b>Tarih</b><span>{imzaTarihi}</span></div>
                <div className="alan">{personelImza ? <img src={personelImza} alt="" /> : null}</div>
                <div className="dijital">{personelImza ? 'Dijital olarak imzalanmıştır' : 'İmza'}</div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* Kullanici istegi (2026-10-14): "ÖNEMLİ NOT" kutusu ve alt bilgi
          satiri kagida sigmadigi icin kaldirildi. */}
      </div>
    </div>
  )
}
