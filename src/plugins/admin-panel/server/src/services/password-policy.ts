/**
 * Sprint 12 · Password Policy
 *
 * Reglas (alineadas con el correo de bienvenida):
 *   - Mínimo 8 caracteres
 *   - Al menos 1 mayúscula
 *   - Al menos 1 minúscula
 *   - Al menos 1 dígito
 *   - Al menos 1 signo (!@#$%&*?-+_=./)
 *
 * Genera contraseñas temporales *pronunciables* de 11 caracteres:
 *   p.ej.  "Lc-9KfRx!2a"   "Tq#7HpBm!4z"
 *
 * Se usa desde:
 *   - admin-panel/server/src/controllers/users-admin.ts (creación manual)
 *   - admin-panel/server/src/controllers/users-bulk.ts  (importación Excel)
 *   - webapp /cambiar-contrasena (valida lado servidor)
 */

import { randomInt } from 'node:crypto';

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin I, O (ambigüedad visual)
const LOWER = 'abcdefghijkmnpqrstuvwxyz'; // sin l, o
const DIGIT = '23456789';                  // sin 0, 1
const SIGN  = '!@#$%&*?-+_=.';

function pick(pool: string): string {
  return pool[randomInt(pool.length)];
}

function shuffle(arr: string[]): string[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Genera una contraseña temporal que *siempre* cumple la policy. */
export function generateTempPassword(length = 11): string {
  if (length < 8) length = 8;

  const chars: string[] = [
    pick(UPPER),
    pick(LOWER),
    pick(DIGIT),
    pick(SIGN),
  ];

  const all = UPPER + LOWER + DIGIT + SIGN;
  while (chars.length < length) chars.push(pick(all));

  return shuffle(chars).join('');
}

export interface PolicyResult {
  ok: boolean;
  errors: string[];
}

/** Valida una contraseña contra la policy. */
export function validatePassword(pwd: string): PolicyResult {
  const errors: string[] = [];
  if (!pwd || typeof pwd !== 'string') {
    return { ok: false, errors: ['La contraseña es requerida.'] };
  }
  if (pwd.length < 8) errors.push('Debe tener al menos 8 caracteres.');
  if (!/[A-Z]/.test(pwd)) errors.push('Debe tener al menos una letra mayúscula.');
  if (!/[a-z]/.test(pwd)) errors.push('Debe tener al menos una letra minúscula.');
  if (!/[0-9]/.test(pwd)) errors.push('Debe tener al menos un número.');
  if (!/[!@#$%&*?\-+_=.\/]/.test(pwd)) errors.push('Debe tener al menos un signo (!@#$%&*?).');
  return { ok: errors.length === 0, errors };
}
