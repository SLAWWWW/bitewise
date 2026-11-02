/**
 * FLO contact addresses: encrypted at rest (AES-256-GCM, src/security/crypto). Only
 * flo.edit holders see the clear address; everyone else sees the masked hint.
 *
 * AAD convention (binds a ciphertext to its tenant so rows cannot be swapped across
 * tenants): the tenant id. Rows written without AAD still decrypt (fallback), so a
 * seed that did not bind AAD keeps working.
 */
import { decryptContact, encryptContact, maskAddress } from '@/src/security/crypto';

export function contactAad(tenantId: string): string {
  return tenantId;
}

export function sealContact(address: string, tenantId: string): { ciphertext: Buffer; hint: string } {
  return { ciphertext: encryptContact(address, { aad: contactAad(tenantId) }), hint: maskAddress(address) };
}

/** Clear address, or null when it cannot be decrypted (wrong key / tampered). Never throws. */
export function revealContact(ciphertext: Buffer | Uint8Array | null | undefined, tenantId: string): string | null {
  if (!ciphertext) return null;
  for (const aad of [contactAad(tenantId), undefined]) {
    try {
      return decryptContact(ciphertext, aad ? { aad } : {});
    } catch {
      /* try the next convention */
    }
  }
  return null;
}
