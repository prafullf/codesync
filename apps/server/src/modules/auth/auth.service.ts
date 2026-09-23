import { Prisma, type User } from '@codesync/db';
import type { LoginBody, PublicUser, SignupBody } from '@codesync/shared';
import { errors } from '../../lib/errors';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password';
import { signToken } from './tokens';
import type { UserRepository } from './user.repository';

export interface AuthResult {
  user: PublicUser;
  token: string;
}

export function toPublicUser(user: User): PublicUser {
  return { id: user.id, email: user.email, name: user.name };
}

export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly jwtSecret: string,
  ) {}

  async signup(input: SignupBody): Promise<AuthResult> {
    const passwordHash = await hashPassword(input.password);
    try {
      const user = await this.users.create({ email: input.email, name: input.name, passwordHash });
      return this.issue(user);
    } catch (err) {
      // Unique constraint on email: rely on the DB instead of check-then-insert (race-free).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw errors.conflict('An account with this email already exists');
      }
      throw err;
    }
  }

  async login(input: LoginBody): Promise<AuthResult> {
    const user = await this.users.findByEmail(input.email);
    const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw errors.unauthorized('Invalid email or password');
    return this.issue(user);
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) throw errors.unauthorized();
    return toPublicUser(user);
  }

  private issue(user: User): AuthResult {
    return { user: toPublicUser(user), token: signToken({ id: user.id, name: user.name }, this.jwtSecret) };
  }
}
