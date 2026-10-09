const { Client } = require('pg');
require('dotenv').config();

const typeMap = {
  '1': 'Dosya', 
  '2': 'Ekmek', 
  '3': 'Gıda Bankası', 
  '6': 'Destek Paketi', 
  '7': 'Giyim', 
  '10': 'Dönem Dışı Gıda', 
  '12': 'Aceze', 
  '5': 'Ayni/Nakdi', 
};

function replaceVariables(text) {
  if (!text) return '';
  let res = text.replace(/&#34;/g, '"').replace(/&#13;&#10;/g, '\n');
  
  res = res.replace(/\[DS_Dosya\."?dosyano"?\]/gi, '{{dosya.dosyano}}');
  res = res.replace(/\[DS_Dosya\."?adres"?\]/gi, '{{dosya.adres}}');
  res = res.replace(/\[DS_Dosya\."?mahalle"?\]/gi, '{{dosya.mahalle}}');
  res = res.replace(/\[DS_Dosya\."?telefon"?\]/gi, '{{dosya.telefon}}');
  res = res.replace(/\[DS_Dosya\."?tc"?\]/gi, '{{kisi.tc}}');
  res = res.replace(/\[DS_Muracaatci\."?adisoyadi"?\]/gi, '{{kisi.ad_soyad}}');
  res = res.replace(/\[DS_Muracaatci\."?tckimlikno"?\]/gi, '{{kisi.tc}}');
  res = res.replace(/\[DS_Yardim\."?tckimlikno"?\]/gi, '{{kisi.tc}}');
  res = res.replace(/\[DS_Yardim\."?kullaniciadi"?\]/gi, '{{kisi.ad_soyad}}');
  res = res.replace(/\[DS_Yardim\."?aciklama"?\]/gi, '{{yardim.aciklama}}');
  res = res.replace(/\[DS_Yardim\."?miktar"?\]/gi, '{{yardim.miktar}}');
  res = res.replace(/\[DS_Yardim\."?bastarih"?\]/gi, '{{yardim.bas_tarih}}');
  res = res.replace(/\[DS_Yardim\."?bittarih"?\]/gi, '{{yardim.bit_tarih}}');
  res = res.replace(/\[Date\]/gi, '{{cikti.tarih}}');
  res = res.replace(/\[Time\]/gi, '{{cikti.saat}}');
  
  if (res.startsWith('[') && res.endsWith(']') && !res.includes('{{')) {
    res = res.substring(1, res.length - 1);
  }
  return res;
}

function parseAttributes(elementString) {
  const attrs = {};
  const attrRegex = /([a-zA-Z0-9_\.]+)=["']([^"']*)["']/g;
  let match;
  while ((match = attrRegex.exec(elementString)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function parseFloatComma(str) {
  if (!str) return 0;
  return parseFloat(str.replace(',', '.'));
}

async function migrateDesigns() {
const legacyClient = new Client({ connectionString: process.env.SOSYALYARDIMDKM_DATABASE_URL });
  const newClient = new Client({ connectionString: process.env.DATABASE_URL });

  try {
    await legacyClient.connect();
    await newClient.connect();

    const { rows } = await legacyClient.query("SELECT id, tipi, adi, dizayn FROM dizayn WHERE varsayilan = 1 AND tipi IS NOT NULL");
    const formDesigns = [];

    for (const row of rows) {
      let dizaynXml = row.dizayn;
      if (!dizaynXml) continue;
      if (Buffer.isBuffer(dizaynXml)) {
        dizaynXml = dizaynXml.toString('utf8');
      }

      const bands = [];
      const blocks = [];
      
      // FastReport XML içerisindeki sayfaları bul
      // Sayfaları ayırmak için kaba bir split kullanalım
      const pages = dizaynXml.split(/<TfrxReportPage/i).slice(1);
      
      pages.forEach((pageContent, index) => {
        const pageHeader = '<TfrxReportPage ' + pageContent.split('>')[0] + '>';
        const pageAttrs = parseAttributes(pageHeader);
        
        const paperWidth = parseFloatComma(pageAttrs['PaperWidth']);
        const paperHeight = parseFloatComma(pageAttrs['PaperHeight']);
        
        // Her sayfayı bizim sistemde bir "Bant" gibi düşünelim
        const bandId = 'bnd_pg_' + index + '_' + Date.now();
        // A4 standart yükseklik px bazında (297mm * 3.78 ~= 1123px)
        const h = paperHeight > 0 ? Math.round(paperHeight * 3.78) : 1123;
        
        bands.push({
          id: bandId,
          type: 'MasterData',
          name: `Sayfa ${index + 1} (${pageAttrs['Name'] || 'Adsız'})`,
          height: h
        });

        // Sayfa içindeki elemanları bul
        const elementRegex = /<Tfrx(MemoView|BarCodeView)[^>]*>/gi;
        let match;
        while ((match = elementRegex.exec(pageContent)) !== null) {
          const elementType = match[1];
          const attrs = parseAttributes(match[0]);
          
          const left = parseFloatComma(attrs['Left']);
          const top = parseFloatComma(attrs['Top']);
          const rawText = attrs['Text'] || attrs['Expression'] || '';
          const parsedText = replaceVariables(rawText);
          const isBarcode = elementType === 'BarCodeView';
          
          if (!parsedText.trim() && !isBarcode) continue;

          blocks.push({
            id: 'blk_' + Math.random().toString(36).substr(2, 9),
            bandId: bandId,
            type: isBarcode ? 'barcode' : (parsedText.includes('{{') ? 'variable' : 'text'),
            x: Math.round(left),
            y: Math.round(top),
            width: attrs['Width'] ? Math.round(parseFloatComma(attrs['Width'])) : undefined,
            height: attrs['Height'] ? Math.round(parseFloatComma(attrs['Height'])) : undefined,
            value: parsedText || '{{dosya.dosyano}}',
            fontSize: attrs['Font.Height'] ? Math.abs(parseInt(attrs['Font.Height'])) : 12,
            fontWeight: attrs['Font.Style'] === '1' ? 'bold' : 'normal'
          });
        }
      });

      // Eğer sayfa bulunamadıysa (boş split), eski usul devam et (nadiren olur)
      if (pages.length === 0) {
          // ... (önceki basit mantık buraya gelebilir ama sayfalar genelde vardır)
      }

      formDesigns.push({
        id: 'migrated_' + row.id,
        name: row.adi + ' (Eski)',
        type: bands.length > 0 ? 'a4' : 'label', 
        linkedAssistance: typeMap[row.tipi] || 'Tümü',
        width: "210",
        height: "297",
        content: '',
        bands: bands, 
        blocks: blocks
      });
    }

    const existingRes = await newClient.query("SELECT key as id, value FROM app_settings WHERE key = 'form_design_templates'");
    let existingData = [];
    if (existingRes.rows.length > 0) {
       existingData = existingRes.rows[0].value || [];
       existingData = existingData.filter(d => !d.id.startsWith('migrated_')); 
    }
    
    const merged = [...formDesigns, ...existingData];
    
    if (existingRes.rows.length > 0) {
      await newClient.query(
        "UPDATE app_settings SET value = $1::jsonb, updated_at = NOW() WHERE key = 'form_design_templates'", 
        [JSON.stringify(merged)]
      );
    } else {
      await newClient.query(
        "INSERT INTO app_settings (key, value, type, updated_at) VALUES ('form_design_templates', $1::jsonb, 'json', NOW())", 
        [JSON.stringify(merged)]
      );
    }

    console.log(`Başarılı! Toplam ${formDesigns.length} adet tasarım (çoklu sayfa desteğiyle) aktarıldı.`);
  } catch (err) {
    console.error("Aktarım hatası:", err);
  } finally {
    await legacyClient.end();
    await newClient.end();
  }
}

migrateDesigns();
