import 'server-only'

import { randomBytes, scrypt, timingSafeEqual } from 'crypto'

const SCRYPT_PREFIX = 's'
const SALT_BYTES = 12
const KEY_LENGTH = 20

function deriveKey(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (error, key) => {
      if (error) reject(error)
      else resolve(key as Buffer)
    })
  })
}

export async function hashPassword(password: string) {
  const salt = randomBytes(SALT_BYTES).toString('base64url')
  const key = await deriveKey(password, salt)
  return `${SCRYPT_PREFIX}$${salt}$${key.toString('base64url')}`
}

export async function verifyScryptPassword(password: string, storedPassword: string) {
  const [prefix, salt, encodedKey, ...rest] = storedPassword.split('$')
  if (prefix !== SCRYPT_PREFIX || !salt || !encodedKey || rest.length > 0 || !/^[A-Za-z0-9_-]+$/.test(encodedKey)) {
    return false
  }

  const expectedKey = Buffer.from(encodedKey, 'base64url')
  if (expectedKey.length !== KEY_LENGTH) return false

  const actualKey = await deriveKey(password, salt)
  return actualKey.length === expectedKey.length && timingSafeEqual(actualKey, expectedKey)
}

export function isScryptPassword(storedPassword: string) {
  return storedPassword.startsWith(`${SCRYPT_PREFIX}$`)
}
