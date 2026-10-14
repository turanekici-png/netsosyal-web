import { existsSync } from 'node:fs'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Baski onizlemesindeki formu (ör. Dosya Müracaat Formu) A4 PDF olarak
// indirmek icin (kullanici istegi 2026-10-14). Istemci, onizlemenin kendi
// stiliyle birlikte tam HTML'ini gonderir; sunucudaki Chrome/Edge (WhatsApp
// ile ayni kurulu tarayici) bunu vektorel PDF'e cevirir.
// Guvenlik: HTML kullanicidan geldigi icin sayfada JavaScript KAPALI ve
// data: disindaki TUM ag istekleri engellenir (sunucu uzerinden ic aga
// istek atilamaz) - gorseller istemcide data URL'e cevrilerek gonderilir.

const HTML_EN_FAZLA = 8_000_000

// turbopackIgnore: bkz. whatsappWeb.service.ts resolveBrowserExecutable notu.
function tarayiciYolu(): string | undefined {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || process.env.WHATSAPP_CHROME_PATH
  if (fromEnv && existsSync(/* turbopackIgnore: true */ fromEnv)) return fromEnv
  const adaylar = process.platform === 'win32'
    ? [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        `${process.env.LOCALAPPDATA || ''}/Google/Chrome/Application/chrome.exe`,
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
      ]
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  return adaylar.find((aday) => aday && existsSync(/* turbopackIgnore: true */ aday))
}

function dosyaAdi(value: unknown): string {
  const temiz = String(value ?? '').replace(/[^\p{L}\p{N} ._-]+/gu, '').trim().slice(0, 120)
  return (temiz || 'form').replace(/\.pdf$/i, '') + '.pdf'
}

export async function POST(request: NextRequest) {
  const accessDenied = await requireApiAccess({ action: 'documents.print', page: '/documents' })
  if (accessDenied) return accessDenied

  let browser: import('puppeteer-core').Browser | null = null
  try {
    const body = await request.json() as { html?: unknown; fileName?: unknown }
    const html = typeof body.html === 'string' ? body.html : ''
    if (!html.trim()) return NextResponse.json({ success: false, error: 'PDF içeriği boş.' }, { status: 400 })
    if (html.length > HTML_EN_FAZLA) return NextResponse.json({ success: false, error: 'PDF içeriği çok büyük.' }, { status: 400 })

    const executablePath = tarayiciYolu()
    if (!executablePath) {
      return NextResponse.json({ success: false, error: 'Sunucuda PDF üretmek için Chrome/Edge bulunamadı.' }, { status: 500 })
    }

    const puppeteer = await import('puppeteer-core')
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--disable-extensions', '--no-first-run'],
    })
    const page = await browser.newPage()
    await page.setJavaScriptEnabled(false)
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      if (req.url().startsWith('data:') || req.url() === 'about:blank') void req.continue()
      else void req.abort()
    })
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 })
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true })

    const ad = dosyaAdi(body.fileName)
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${ad.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(ad)}`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'PDF oluşturulamadı.' }, { status: 500 })
  } finally {
    await browser?.close().catch(() => {})
  }
}
