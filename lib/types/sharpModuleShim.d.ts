// 'sharp' paketinin package.json "exports" alanında bir "types" kosulu
// tanimli degil (sadece "import"/"require") - bu yuzden TypeScript'in
// "bundler" moduleResolution'i, node_modules/sharp/lib/index.d.ts DOSYASI
// VAR OLMASINA RAGMEN onu bulamiyor ("implicitly has an 'any' type" hatasi -
// bkz. lib/services/imageCompression.service.ts). Burada, gercekte
// kullandigimiz DAR API yuzeyi (buffer/ham piksel al, dondur/kucult/
// netlestir/JPEG'e cevir, buffer'a geri don) icin minimal ama dogru bir
// tip beyani verilir.
declare module 'sharp' {
  interface SharpResizeOptions {
    width?: number
    height?: number
    fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside'
    withoutEnlargement?: boolean
  }

  interface SharpJpegOptions {
    quality?: number
    mozjpeg?: boolean
  }

  interface SharpRawOptions {
    width: number
    height: number
    channels: 1 | 2 | 3 | 4
  }

  interface SharpCreateOptions {
    raw: SharpRawOptions
  }

  interface SharpInstance {
    rotate(): SharpInstance
    resize(options: SharpResizeOptions): SharpInstance
    sharpen(): SharpInstance
    jpeg(options?: SharpJpegOptions): SharpInstance
    png(options?: { quality?: number }): SharpInstance
    toBuffer(): Promise<Buffer>
  }

  function sharp(input: Buffer | Uint8Array, options?: SharpCreateOptions): SharpInstance

  export default sharp
}
