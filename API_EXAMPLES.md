/**
 * API TEST ÖRNEKLERI
 * 
 * Başlamak için Postman veya curl kullanabilirsin
 */

// 1. YENİ BİREY EKLE
POST /api/beneficiary
{
  "name": "Ahmet Yılmaz",
  "email": "ahmet@example.com",
  "phone": "05551234567",
  "address": "İstanbul/Türkiye",
  "status": "active"
}

// 2. BİREY LİSTESİ
GET /api/beneficiary?page=1&limit=10

// 3. BİREY GÜNCELLE
PUT /api/beneficiary/{id}
{
  "name": "Mehmet Yılmaz",
  "phone": "05559876543"
}

// 4. BİREY SİL
DELETE /api/beneficiary/{id}

// 5. MÜRACAAT EKLE
POST /api/requests
{
  "title": "Mali Yardım Talebim",
  "description": "Hastalık nedeniyle mali yardım talebim vardır",
  "type": "financial",
  "beneficiaryId": "{beneficiary-id}",
  "priority": 1
}

// 6. YARDIM EKLE
POST /api/assistance
{
  "amount": 5000,
  "description": "Kira yardımı",
  "type": "financial",
  "beneficiaryId": "{beneficiary-id}",
  "requestId": "{request-id}"
}

// 7. RAPOR OLUŞTUR
POST /api/reports/generate
- Beneficiary raporu oluşturur

// 8. AYAR KAYDET
POST /api/settings
{
  "key": "app_name",
  "value": "Sosyal Yardım Sistemi",
  "type": "string"
}
