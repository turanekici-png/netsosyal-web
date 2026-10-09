function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

type PrintFormDesignOptions = {
  widthMm?: number
  heightMm?: number
  offsetXmm?: number
  offsetYmm?: number
  insetLeftMm?: number
  insetRightMm?: number
  insetTopMm?: number
  insetBottomMm?: number
}

export function printFormDesignHtml(title: string, html: string, options: PrintFormDesignOptions = {}) {
  const pxPerMm = 96 / 25.4
  const isSizedPrint = Boolean(options.widthMm && options.heightMm)
  const insetLeftMm = Number.isFinite(options.insetLeftMm) ? Number(options.insetLeftMm) : Number(options.offsetXmm || 0)
  const insetTopMm = Number.isFinite(options.insetTopMm) ? Number(options.insetTopMm) : Number(options.offsetYmm || 0)
  const insetRightMm = Number.isFinite(options.insetRightMm) ? Number(options.insetRightMm) : 0
  const insetBottomMm = Number.isFinite(options.insetBottomMm) ? Number(options.insetBottomMm) : 0
  const fitWidthMm = isSizedPrint ? Math.max(1, Number(options.widthMm) - Math.max(0, insetLeftMm) - Math.max(0, insetRightMm)) : 0
  const fitHeightMm = isSizedPrint ? Math.max(1, Number(options.heightMm) - Math.max(0, insetTopMm) - Math.max(0, insetBottomMm)) : 0
  const fitScale = isSizedPrint
    ? Math.min(1, fitWidthMm / Number(options.widthMm), fitHeightMm / Number(options.heightMm))
    : 1
  const pageSize = isSizedPrint ? `size: ${options.widthMm}mm ${options.heightMm}mm;` : ''
  const pageWidth = isSizedPrint ? `${options.widthMm}mm` : 'auto'
  const pageHeight = isSizedPrint ? `${options.heightMm}mm` : 'auto'
  const sizedPageCss = isSizedPrint
    ? `
            min-width: ${pageWidth};
            width: ${pageWidth};
            max-width: ${pageWidth};
            min-height: ${pageHeight};
            height: ${pageHeight};
            max-height: ${pageHeight};
            overflow: hidden;`
    : `
            width: auto;
            height: auto;
            overflow: visible;`
  const sizedRootCss = isSizedPrint
    ? `
            min-width: ${pageWidth};
            width: ${pageWidth};
            max-width: ${pageWidth};
            min-height: ${pageHeight};
            height: ${pageHeight};
            max-height: ${pageHeight};
            overflow: hidden;`
    : `
            width: max-content;
            height: auto;
            overflow: visible;`
  const sizedPrintCss = isSizedPrint
    ? `
            html,
            body {
              min-width: ${pageWidth} !important;
              width: ${pageWidth} !important;
              max-width: ${pageWidth} !important;
              min-height: ${pageHeight} !important;
              height: ${pageHeight} !important;
              max-height: ${pageHeight} !important;
              overflow: hidden !important;
            }
            .print-root {
              position: fixed !important;
              left: ${insetLeftMm}mm !important;
              top: ${insetTopMm}mm !important;
              min-width: ${pageWidth} !important;
              width: ${pageWidth} !important;
              max-width: ${pageWidth} !important;
              min-height: ${pageHeight} !important;
              height: ${pageHeight} !important;
              max-height: ${pageHeight} !important;
              overflow: hidden !important;
              margin: 0 !important;
              padding: 0 !important;
              transform: scale(${fitScale});
              transform-origin: top left;
            }
            .print-root > .relative,
            .print-root > div > .relative {
              border: 0 !important;
              box-shadow: none !important;
              outline: 0 !important;
            }`
    : ''
  const frameWidth = options.widthMm ? `${Math.ceil(options.widthMm * pxPerMm)}px` : '794px'
  const frameHeight = options.heightMm ? `${Math.ceil(options.heightMm * pxPerMm)}px` : '1123px'
  const printFrame = document.createElement('iframe')
  printFrame.style.position = 'fixed'
  printFrame.style.left = '-10000px'
  printFrame.style.top = '0'
  printFrame.style.width = frameWidth
  printFrame.style.height = frameHeight
  printFrame.style.border = '0'
  document.body.appendChild(printFrame)

  const printDocument = printFrame.contentDocument || printFrame.contentWindow?.document
  const printWindow = printFrame.contentWindow

  if (!printDocument || !printWindow) {
    printFrame.remove()
    window.print()
    return
  }

  let isCleanedUp = false
  const cleanup = () => {
    if (isCleanedUp) return
    isCleanedUp = true
    printWindow.removeEventListener('afterprint', cleanup)
    window.removeEventListener('afterprint', cleanup)
    printFrame.remove()
  }

  printDocument.open()
  printDocument.write(`
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          @page { ${pageSize} margin: 0; }
          * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          html, body {
            margin: 0;
            padding: 0;
            ${sizedPageCss}
            background: #fff;
            color: #000;
            font-family: Arial, Helvetica, sans-serif;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .print-root {
            display: block;
            position: relative;
            ${sizedRootCss}
            background: #fff;
          }
          .print-root > * {
            margin: 0 !important;
          }
          .print-root > .relative,
          .print-root > div > .relative {
            margin: 0 !important;
          }
          .form-design-print-page {
            display: block !important;
            position: relative !important;
            page-break-after: always !important;
            break-after: page !important;
          }
          .form-design-print-page:last-child {
            page-break-after: auto !important;
            break-after: auto !important;
          }
          .relative { position: relative; }
          .absolute { position: absolute; }
          .inset-0 { inset: 0; }
          .pointer-events-none { pointer-events: none; }
          .bg-white { background: #fff; }
          .bg-slate-950 { background: #020617; }
          .bg-slate-50 { background: #f8fafc; }
          .border { border: 1px solid #e2e8f0; }
          .border-none { border: 0; }
          .border-b { border-bottom: 1px solid #e2e8f0; }
          .border-dashed { border-style: dashed; }
          .last\\:border-b-0:last-child { border-bottom: 0; }
          .overflow-hidden { overflow: hidden; }
          .text-black { color: #000; }
          .leading-tight { line-height: 1.25; }
          .break-words { overflow-wrap: break-word; }
          .whitespace-nowrap { white-space: nowrap; }
          .flex { display: flex; }
          .flex-col { flex-direction: column; }
          .items-center { align-items: center; }
          .gap-1 { gap: 0.25rem; }
          .flex-1 { flex: 1 1 0%; }
          .w-full { width: 100%; }
          .h-auto { height: auto; }
          .object-contain { object-fit: contain; }
          .text-\\[10px\\] { font-size: 10px; }
          .text-\\[8px\\] { font-size: 8px; }
          .truncate {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .text-center { text-align: center; }
          .min-h-\\[2rem\\] { min-height: 2rem; }
          .min-w-\\[3rem\\] { min-width: 3rem; }
          .min-h-\\[3rem\\] { min-height: 3rem; }
          .bg-\\[repeating-linear-gradient\\(90deg\\2c black\\2c black_2px\\2c transparent_2px\\2c transparent_4px\\)\\] {
            background: repeating-linear-gradient(90deg, black, black 2px, transparent 2px, transparent 4px);
          }
          .select-none {
            display: none !important;
          }
          @media print {
            @page { ${pageSize} margin: 0; }
            ${sizedPrintCss}
            .print\\:break-after-page { break-after: page; page-break-after: always; }
            .print\\:break-after-page:last-child { break-after: auto; page-break-after: auto; }
            .form-design-print-page { page-break-after: always !important; break-after: page !important; }
            .form-design-print-page:last-child { page-break-after: auto !important; break-after: auto !important; }
          }
        </style>
      </head>
      <body><div class="print-root">${html}</div></body>
    </html>
  `)
  printDocument.close()

  printWindow.addEventListener('afterprint', cleanup)
  window.addEventListener('afterprint', cleanup)

  setTimeout(() => {
    printWindow.focus()
    printWindow.print()
  }, 300)
}
