import 'server-only'

import { Pool } from 'pg'
import { createUtcTypeOverrides } from '@/lib/db/pgTypeParsers'

type CommunicationStorageGlobal = typeof globalThis & {
  communicationStoragePool?: Pool
  communicationStorageReady?: Promise<void>
}

const globalStorage = globalThis as CommunicationStorageGlobal

function connectionString() {
  if (process.env.COMMUNICATION_DATABASE_URL) return process.env.COMMUNICATION_DATABASE_URL
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL tanımlı değil.')

  const url = new URL(process.env.DATABASE_URL)
  url.pathname = '/sosyalyardimdkm'
  return url.toString()
}

function pool() {
  if (!globalStorage.communicationStoragePool) {
    globalStorage.communicationStoragePool = new Pool({ connectionString: connectionString(), types: createUtcTypeOverrides() } as any)
  }
  return globalStorage.communicationStoragePool
}

export function ensureCommunicationStorage() {
  if (!globalStorage.communicationStorageReady) {
    globalStorage.communicationStorageReady = pool().query(`
      CREATE TABLE IF NOT EXISTS kurum_msj (
        id BIGSERIAL PRIMARY KEY,
        kaynak_iletisim_id BIGINT NOT NULL,
        kaynak_ek_id BIGINT,
        kayit_turu VARCHAR(10) NOT NULL,
        tur VARCHAR(20) NOT NULL,
        gonderen_kullanici_id BIGINT NOT NULL,
        alici_kullanici_ids BIGINT[] NOT NULL DEFAULT '{}',
        baslik VARCHAR(200),
        mesaj_icerigi TEXT,
        dosya_adi VARCHAR(255),
        mime_turu VARCHAR(100),
        dosya_boyutu INTEGER,
        dosya_icerigi BYTEA,
        olusturma_tarihi TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        silinme_tarihi TIMESTAMP(6) NOT NULL,
        CONSTRAINT chk_kurum_msj_kayit_turu CHECK (kayit_turu IN ('mesaj', 'dosya'))
      );
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'uq_kurum_msj_mesaj') THEN
          CREATE UNIQUE INDEX uq_kurum_msj_mesaj ON kurum_msj (kaynak_iletisim_id) WHERE kayit_turu = 'mesaj';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'uq_kurum_msj_dosya') THEN
          CREATE UNIQUE INDEX uq_kurum_msj_dosya ON kurum_msj (kaynak_ek_id) WHERE kaynak_ek_id IS NOT NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_kurum_msj_alicilar') THEN
          CREATE INDEX idx_kurum_msj_alicilar ON kurum_msj USING GIN (alici_kullanici_ids);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_kurum_msj_silinme') THEN
          CREATE INDEX idx_kurum_msj_silinme ON kurum_msj (silinme_tarihi);
        END IF;
      END $$;
    `).then(() => undefined).catch((error) => {
      globalStorage.communicationStorageReady = undefined
      throw error
    })
  }
  return globalStorage.communicationStorageReady
}

type StoredAttachment = {
  sourceAttachmentId: bigint
  fileName: string
  mimeType: string
  fileSize: number
  content: Buffer
}

export async function saveCommunicationToStorage(input: {
  sourceCommunicationId: bigint
  type: string
  senderUserId: bigint
  recipientUserIds: bigint[]
  subject: string | null
  content: string
  attachments: StoredAttachment[]
}) {
  await ensureCommunicationStorage()
  const client = await pool().connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO kurum_msj (
        kaynak_iletisim_id, kaynak_ek_id, kayit_turu, tur, gonderen_kullanici_id,
        alici_kullanici_ids, baslik, mesaj_icerigi, silinme_tarihi
      )
      SELECT $1, NULL, 'mesaj', $2, $3, $4::bigint[], $5, $6, CURRENT_TIMESTAMP + INTERVAL '180 days'
      WHERE NOT EXISTS (
        SELECT 1 FROM kurum_msj WHERE kaynak_iletisim_id = $1 AND kayit_turu = 'mesaj'
      )`,
      [input.sourceCommunicationId.toString(), input.type, input.senderUserId.toString(), input.recipientUserIds.map(String), input.subject, input.content],
    )

    for (const attachment of input.attachments) {
      await client.query(
        `INSERT INTO kurum_msj (
          kaynak_iletisim_id, kaynak_ek_id, kayit_turu, tur, gonderen_kullanici_id,
          alici_kullanici_ids, baslik, mesaj_icerigi, dosya_adi, mime_turu,
          dosya_boyutu, dosya_icerigi, silinme_tarihi
        )
        SELECT $1, $2, 'dosya', $3, $4, $5::bigint[], $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP + INTERVAL '30 days'
        WHERE NOT EXISTS (
          SELECT 1 FROM kurum_msj WHERE kaynak_ek_id = $2 AND kaynak_ek_id IS NOT NULL
        )`,
        [
          input.sourceCommunicationId.toString(), attachment.sourceAttachmentId.toString(), input.type,
          input.senderUserId.toString(), input.recipientUserIds.map(String), input.subject, input.content,
          attachment.fileName, attachment.mimeType, attachment.fileSize, attachment.content,
        ],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function getCommunicationAttachmentFromStorage(sourceAttachmentId: bigint) {
  await ensureCommunicationStorage()
  const result = await pool().query<{
    sender_user_id: string
    recipient_user_ids: string[]
    file_name: string
    mime_type: string
    file_size: number
    content: Buffer
  }>(`
    SELECT
      gonderen_kullanici_id::text AS sender_user_id,
      alici_kullanici_ids::text[] AS recipient_user_ids,
      dosya_adi AS file_name,
      mime_turu AS mime_type,
      dosya_boyutu AS file_size,
      dosya_icerigi AS content
    FROM kurum_msj
    WHERE kaynak_ek_id = $1
      AND kayit_turu = 'dosya'
      AND silinme_tarihi > CURRENT_TIMESTAMP
    LIMIT 1
  `, [sourceAttachmentId.toString()])
  return result.rows[0] || null
}

export async function cleanupCommunicationStorage() {
  await ensureCommunicationStorage()
  await pool().query('DELETE FROM kurum_msj WHERE silinme_tarihi <= CURRENT_TIMESTAMP')
}

export async function deleteCommunicationFromStorage(sourceCommunicationId: bigint) {
  await ensureCommunicationStorage()
  await pool().query(
    'DELETE FROM kurum_msj WHERE kaynak_iletisim_id = $1',
    [sourceCommunicationId.toString()],
  )
}
