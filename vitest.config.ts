import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// Kritik saf mantik (oturum, parola politikasi, TC dogrulama, SQL filtre
// uretici, online basvuru kriterleri) icin birim testleri. DB / ag gerektiren
// akislar kapsam disi - onlar entegrasyon testi konusu.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      // lib/auth.ts imza icin AUTH_SECRET bekler.
      AUTH_SECRET: 'test-only-secret-0123456789abcdef0123456789abcdef',
    },
  },
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
})
