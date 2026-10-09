const { config } = require('dotenv')
const { Client } = require('pg')

config({ path: process.env.DOTENV_CONFIG_PATH || '.env.local' })

async function main() {
  const source = process.env.COMMUNICATION_DATABASE_URL || process.env.DATABASE_URL
  if (!source) throw new Error('DATABASE_URL tanımlı değil.')
  const url = new URL(source)
  if (!process.env.COMMUNICATION_DATABASE_URL) url.pathname = '/sosyalyardimdkm'

  const client = new Client({ connectionString: url.toString() })
  await client.connect()
  await client.query(`
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
  `)
  await client.end()
  console.log('sosyalyardimdkm.kurum_msj hazır.')
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
