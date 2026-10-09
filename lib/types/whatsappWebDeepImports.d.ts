// 'whatsapp-web.js' paketinin ana index.js barrel dosyası, kullanmadığımız
// RemoteAuth stratejisini de içe aktarır ve bu, 'unzipper' -> '@aws-sdk/client-s3'
// zincirini sürükleyerek Next.js build sırasında "Module not found" hatasına
// yol açar (bkz. lib/services/whatsappWeb.service.ts). Bu yüzden sadece
// ihtiyaç duyulan iki alt-modül doğrudan (deep import) yüklenir - TypeScript
// bu yolların tip bildirimi olmadığını bilmediği için burada tanımlanır.
declare module 'whatsapp-web.js/src/Client.js';
declare module 'whatsapp-web.js/src/authStrategies/LocalAuth.js';
