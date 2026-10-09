import { getSqlMonitorPool } from './sqlMonitor.service'
import {
  DEFAULT_PREDEFINED_VALUE_TITLES,
  DEFAULT_PREDEFINED_VALUES,
  type PredefinedValueTitlesMap,
  type PredefinedValuesMap,
} from '@/lib/constants/predefinedValues'

const predefinedValuesKey = 'predefinedValues'
const predefinedValueTitlesKey = 'predefinedValueTitles'
const predefinedValuesCacheTtlMs = 30_000

type PredefinedValuesResult = {
  values: PredefinedValuesMap
  titles: PredefinedValueTitlesMap
}

let ensureSettingsTablePromise: Promise<void> | null = null
let predefinedValuesCache: { value: PredefinedValuesResult; expiresAt: number } | null = null
let predefinedValuesLoadPromise: Promise<PredefinedValuesResult> | null = null

const ensureSettingsTable = async () => {
  if (!ensureSettingsTablePromise) {
    const pool = getSqlMonitorPool()
    ensureSettingsTablePromise = pool.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key text PRIMARY KEY,
        value jsonb NOT NULL,
        type text NOT NULL DEFAULT 'json',
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `).then(() => undefined).catch((error) => {
      ensureSettingsTablePromise = null
      throw error
    })
  }

  await ensureSettingsTablePromise
}

const repairTurkishText = (value: string) =>
  value
    .replaceAll('Yeni KayÄ±t', 'Yeni Kayıt')
    .replaceAll('YardÄ±m AlÄ±yor', 'Yardım Alıyor')
    .replaceAll('Ar??ivlendi', 'Arşivlendi')
    .replaceAll('ArÅŸivlendi', 'Arşivlendi')
    .replaceAll('ArÃ…Å¸ivlendi', 'Arşivlendi')
    .replaceAll('Tamamland??', 'Tamamlandı')
    .replaceAll('TamamlandÄ±', 'Tamamlandı')
    .replaceAll('TamamlandÃ„Â±', 'Tamamlandı')
    .replaceAll('??ptal', 'İptal')
    .replaceAll('Ä°ptal', 'İptal')
    .replaceAll('Ã„Â°ptal', 'İptal')
    .replaceAll('Yard??m', 'Yardım')
    .replaceAll('YardÄ±m', 'Yardım')
    .replaceAll('YardÃ„Â±m', 'Yardım')
    .replaceAll('AlÄ±yor', 'Alıyor')
    .replaceAll('Al??yor', 'Alıyor')
    .replaceAll('Alm??yor', 'Almıyor')
    .replaceAll('AlmÄ±yor', 'Almıyor')
    .replaceAll('E??i', 'Eşi')
    .replaceAll('EÅŸi', 'Eşi')
    .replaceAll('EÃ…Å¸i', 'Eşi')
    .replaceAll('O??lu', 'Oğlu')
    .replaceAll('OÄŸlu', 'Oğlu')
    .replaceAll('OÃ„Å¸lu', 'Oğlu')
    .replaceAll('K??z??', 'Kızı')
    .replaceAll('KÄ±zÄ±', 'Kızı')
    .replaceAll('KÃ„Â±zÃ„Â±', 'Kızı')
    .replaceAll('Babas??', 'Babası')
    .replaceAll('BabasÄ±', 'Babası')
    .replaceAll('BabasÃ„Â±', 'Babası')
    .replaceAll('Bo??anm????', 'Boşanmış')
    .replaceAll('BoÅŸanmÄ±ÅŸ', 'Boşanmış')
    .replaceAll('BoÃ…Å¸anmÃ„Â±Ã…Å¸', 'Boşanmış')
    .replaceAll('Sa??l??k', 'Sağlık')
    .replaceAll('SaÄŸlÄ±k', 'Sağlık')
    .replaceAll('SaÃ„Å¸lÃ„Â±k', 'Sağlık')
    .replaceAll('S??re??en', 'Süreğen')
    .replaceAll('SÃ¼reÄŸen', 'Süreğen')
    .replaceAll('SÃƒÂ¼reÃ„Å¸en', 'Süreğen')
    .replaceAll('Hastal??k', 'Hastalık')
    .replaceAll('HastalÄ±k', 'Hastalık')
    .replaceAll('HastalÃ„Â±k', 'Hastalık')
    .replaceAll('Ya??l??', 'Yaşlı')
    .replaceAll('YaÅŸlÄ±', 'Yaşlı')
    .replaceAll('YaÃ…Å¸lÃ„Â±', 'Yaşlı')
    .replaceAll('Bak??ma', 'Bakıma')
    .replaceAll('BakÄ±ma', 'Bakıma')
    .replaceAll('BakÃ„Â±ma', 'Bakıma')
    .replaceAll('Muhta??', 'Muhtaç')
    .replaceAll('MuhtaÃ§', 'Muhtaç')
    .replaceAll('MuhtaÃƒÂ§', 'Muhtaç')
    .replaceAll('YakÄ±nlÄ±k', 'Yakınlık')
    .replaceAll('YakÃ„Â±nlÃ„Â±k', 'Yakınlık')
    .replaceAll('SaÄlÄ±k Durumu', 'Sağlık Durumu')
    .replaceAll('Ä±', 'ı')
    .replaceAll('Ä°', 'İ')
    .replaceAll('Ä\u009f', 'ğ')
    .replaceAll('Ã¼', 'ü')
    .replaceAll('Ã§', 'ç')
    .replaceAll('Å\u009f', 'ş')
    .replaceAll('ÅŸ', 'ş')

const repairValues = (values: PredefinedValuesMap): PredefinedValuesMap =>
  Object.fromEntries(
    Object.entries(values).map(([category, items]) => [
      category,
      items.map((item) => ({
        ...item,
        name: repairTurkishText(item.name),
      })),
    ])
  )

const repairTitles = (titles: PredefinedValueTitlesMap): PredefinedValueTitlesMap =>
  Object.fromEntries(
    Object.entries(titles).map(([category, title]) => [category, repairTurkishText(title)])
  )

const saveSetting = async (key: string, value: unknown) => {
  const pool = getSqlMonitorPool()
  const updateResult = await pool.query(
    `
      UPDATE app_settings
      SET value = $2::jsonb, type = 'json', updated_at = now()
      WHERE key = $1;
    `,
    [key, JSON.stringify(value)]
  )

  if ((updateResult.rowCount ?? 0) > 0) {
    return
  }

  await pool.query(
    `
      INSERT INTO app_settings (key, value, type, updated_at)
      VALUES ($1, $2::jsonb, 'json', now());
    `,
    [key, JSON.stringify(value)]
  )
}

export const predefinedValuesService = {
  async getAll() {
    if (predefinedValuesCache && predefinedValuesCache.expiresAt > Date.now()) {
      return predefinedValuesCache.value
    }

    if (!predefinedValuesLoadPromise) {
      predefinedValuesLoadPromise = (async () => {
        await ensureSettingsTable()
        const pool = getSqlMonitorPool()
        const result = await pool.query<{ key: string; value: unknown }>(
          `
            SELECT key, value
            FROM app_settings
            WHERE key = ANY($1::text[]);
          `,
          [[predefinedValuesKey, predefinedValueTitlesKey]]
        )
        const settings = new Map(result.rows.map((row) => [row.key, row.value]))
        const storedValues = settings.get(predefinedValuesKey) as PredefinedValuesMap | undefined
        const storedTitles = settings.get(predefinedValueTitlesKey) as PredefinedValueTitlesMap | undefined
        const value = {
          values: repairValues({ ...DEFAULT_PREDEFINED_VALUES, ...(storedValues ?? {}) }),
          titles: repairTitles({ ...DEFAULT_PREDEFINED_VALUE_TITLES, ...(storedTitles ?? {}) }),
        }
        predefinedValuesCache = { value, expiresAt: Date.now() + predefinedValuesCacheTtlMs }
        return value
      })().finally(() => {
        predefinedValuesLoadPromise = null
      })
    }

    return predefinedValuesLoadPromise
  },

  async save(values: PredefinedValuesMap, titles: PredefinedValueTitlesMap) {
    predefinedValuesCache = null
    await ensureSettingsTable()
    const repairedValues = repairValues(values)
    const repairedTitles = repairTitles(titles)
    await Promise.all([
      saveSetting(predefinedValuesKey, repairedValues),
      saveSetting(predefinedValueTitlesKey, repairedTitles),
    ])
    predefinedValuesCache = {
      value: { values: repairedValues, titles: repairedTitles },
      expiresAt: Date.now() + predefinedValuesCacheTtlMs,
    }

    return {
      values: repairedValues,
      titles: repairedTitles,
    }
  },
}
