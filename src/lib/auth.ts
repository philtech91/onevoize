import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { db } from '@/lib/db';
import bcrypt from 'bcryptjs';

export type UserRole = 'admin' | 'superadmin';

declare module 'next-auth' {
  interface User {
    id: string;
    role: UserRole;
  }
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      role: UserRole;
    };
  }
  interface JWT {
    id?: string;
    role?: UserRole;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  session: { strategy: 'jwt' },
  pages: { signIn: '/dashboard/login' },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token['id'] = user.id;
        token['role'] = user.role;
        return token;
      }

      if (token['id']) {
        try {
          const rows = await db<{ id: number; name: string; email: string; role: UserRole; is_active: boolean }>(
            'SELECT id, name, email, role, is_active FROM users WHERE id = $1 LIMIT 1',
            [Number(token['id'])],
          );
          const dbUser = rows[0];
          if (!dbUser || !dbUser.is_active) {
            delete token['id'];
            delete token['role'];
            return token;
          }
          token['role'] = dbUser.role;
          token.name = dbUser.name;
          token.email = dbUser.email;
        } catch {
          // Preserve existing token if transient DB check fails
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token && token['id']) {
        session.user.id = String(token['id']);
        session.user.role = (token['role'] as UserRole) ?? 'admin';
      } else {
        session.user.id = '';
      }
      return session;
    },
  },
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const rows = await db(
          'SELECT id, name, email, password, role FROM users WHERE email = $1 AND is_active = TRUE LIMIT 1',
          [credentials.email as string],
        );
        const user = rows[0];
        if (!user) return null;
        const valid = await bcrypt.compare(credentials.password as string, user.password as string);
        if (!valid) return null;
        return { id: String(user.id), name: user.name as string, email: user.email as string, role: user.role as UserRole };
      },
    }),
  ],
});
