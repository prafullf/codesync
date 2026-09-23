import bcrypt from 'bcryptjs';

const COST = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Compared against when the email does not exist, so "unknown email" and
 * "wrong password" take the same time (prevents user enumeration by timing).
 */
export const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', COST);
