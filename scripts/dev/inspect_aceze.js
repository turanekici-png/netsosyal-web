const { Client } = require('pg');
require('dotenv').config();

async function inspectAceze() {
const client = new Client({ connectionString: process.env.SOSYALYARDIMDKM_DATABASE_URL });
  try {
    await client.connect();
    const { rows } = await client.query("SELECT adi, dizayn FROM dizayn WHERE adi LIKE '%ACEZE%' AND varsayilan = 1");
    if (rows.length === 0) {
      console.log("Aceze dizaynı bulunamadı.");
      return;
    }
    const xml = rows[0].dizayn.toString('utf8');
    console.log("--- XML Header ---");
    console.log(xml.substring(0, 500));
    
    console.log("\n--- Bands Found ---");
    const bandRegex = /<Tfrx(ReportTitle|PageHeader|MasterData|PageFooter|Subreport|Header|Footer|GroupHeader|GroupFooter|PageTitle|ReportSummary|ColumnHeader|ColumnFooter|Overlay|OverlayHeader|OverlayFooter|DetailData) Name="([^"]+)"[^>]*Height="([^"]*)"/gi;
    let match;
    while ((match = bandRegex.exec(xml)) !== null) {
      console.log(`Type: ${match[1]}, Name: ${match[2]}, Height: ${match[3]}`);
    }
    
    console.log("\n--- Multi-page Check ---");
    const pageRegex = /<TfrxReportPage Name="([^"]+)"/gi;
    while ((match = pageRegex.exec(xml)) !== null) {
      console.log(`Page: ${match[1]}`);
    }

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
inspectAceze();
