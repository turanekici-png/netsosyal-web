import 'server-only'

// GUVENLIK: Next.js App Router'da request.json() gövde boyutunu SINIRLAMAZ.
// base64 gorsel/belge kabul eden uc noktalarda kotu niyetli (veya hatali) bir
// istemci cok buyuk bir govde gondererek sunucu bellegini sisirebilir (DoS).
// Bu yardimci once Content-Length'e bakar, sonra govdeyi bayt bayt okuyarak
// sinira ulasilinca akisi keser.

export class RequestBodyTooLargeError extends Error {
  constructor(public readonly limitBytes: number) {
    super(`İstek gövdesi çok büyük (en fazla ${Math.floor(limitBytes / (1024 * 1024))} MB).`)
    this.name = 'RequestBodyTooLargeError'
  }
}

const DEFAULT_LIMIT_BYTES = 12 * 1024 * 1024 // 12 MB

export async function readLimitedText(
  request: Request,
  limitBytes: number = DEFAULT_LIMIT_BYTES,
): Promise<string> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limitBytes) {
    throw new RequestBodyTooLargeError(limitBytes)
  }

  const body = request.body
  if (!body) return await request.text()

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        if (total > limitBytes) {
          try { await reader.cancel() } catch { /* yoksay */ }
          throw new RequestBodyTooLargeError(limitBytes)
        }
        chunks.push(value)
      }
    }
  } finally {
    try { reader.releaseLock() } catch { /* yoksay */ }
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

export async function readLimitedJson<T = unknown>(
  request: Request,
  limitBytes: number = DEFAULT_LIMIT_BYTES,
): Promise<T> {
  const text = await readLimitedText(request, limitBytes)
  return JSON.parse(text) as T
}
