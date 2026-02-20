/**
 * Authentication Recipe
 *
 * Adds user authentication to a project using NextAuth.js
 */

import type { Recipe } from '../types';

export const authRecipe: Recipe = {
  id: 'add-authentication',
  name: 'Add Authentication',
  description: 'Add user authentication with NextAuth.js including login, register, and session management',
  category: 'authentication',
  icon: 'lock',
  tags: ['auth', 'login', 'nextauth', 'session', 'user'],
  compatibleStacks: ['nextjs-prisma'],
  version: '1.0.0',
  author: 'Singularity',

  parameters: [
    {
      name: 'providers',
      type: 'multiselect',
      label: 'Authentication Providers',
      description: 'Select the authentication providers to enable',
      required: true,
      default: ['credentials'],
      options: [
        { value: 'credentials', label: 'Email/Password' },
        { value: 'google', label: 'Google OAuth' },
        { value: 'github', label: 'GitHub OAuth' },
        { value: 'discord', label: 'Discord OAuth' }
      ]
    },
    {
      name: 'includeRegister',
      type: 'boolean',
      label: 'Include Registration',
      description: 'Add a user registration page',
      required: false,
      default: true
    },
    {
      name: 'includeProfile',
      type: 'boolean',
      label: 'Include Profile Page',
      description: 'Add a user profile page',
      required: false,
      default: true
    }
  ],

  steps: [
    // Step 1: Add NextAuth dependencies
    {
      id: 'install-deps',
      name: 'Install Dependencies',
      description: 'Install NextAuth.js and bcrypt',
      type: 'command',
      config: {
        command: 'npm install next-auth @auth/prisma-adapter bcryptjs',
        timeout: 120000
      }
    },
    {
      id: 'install-types',
      name: 'Install TypeScript Types',
      description: 'Install type definitions',
      type: 'command',
      config: {
        command: 'npm install -D @types/bcryptjs',
        timeout: 60000
      }
    },

    // Step 2: Update Prisma schema for auth
    {
      id: 'update-schema',
      name: 'Update Prisma Schema',
      description: 'Add auth models to Prisma schema',
      type: 'file_modify',
      config: {
        path: 'prisma/schema.prisma',
        modifications: [
          {
            type: 'append',
            content: `
// NextAuth.js Models
model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model User {
  id            String    @id @default(cuid())
  name          String?
  email         String?   @unique
  emailVerified DateTime?
  image         String?
  password      String?
  accounts      Account[]
  sessions      Session[]
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}
`
          }
        ]
      }
    },

    // Step 3: Create auth configuration
    {
      id: 'create-auth-config',
      name: 'Create Auth Configuration',
      description: 'Create NextAuth configuration file',
      type: 'file_create',
      config: {
        path: 'src/lib/auth.ts',
        template: `import { NextAuthOptions } from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import prisma from './prisma';

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Invalid credentials');
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email }
        });

        if (!user || !user.password) {
          throw new Error('Invalid credentials');
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password,
          user.password
        );

        if (!isPasswordValid) {
          throw new Error('Invalid credentials');
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image
        };
      }
    })
  ],
  session: {
    strategy: 'jwt'
  },
  pages: {
    signIn: '/login',
    signOut: '/logout',
    error: '/auth/error'
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
      }
      return session;
    }
  }
};
`
      }
    },

    // Step 4: Create API route
    {
      id: 'create-api-route',
      name: 'Create NextAuth API Route',
      description: 'Create the NextAuth API handler',
      type: 'file_create',
      config: {
        path: 'src/app/api/auth/[...nextauth]/route.ts',
        template: `import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth';

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
`
      }
    },

    // Step 5: Create login page
    {
      id: 'create-login-page',
      name: 'Create Login Page',
      description: 'Create the login page component',
      type: 'file_create',
      config: {
        path: 'src/app/(auth)/login/page.tsx',
        template: `'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false
      });

      if (result?.error) {
        setError('Invalid email or password');
      } else {
        router.push('/');
        router.refresh();
      }
    } catch {
      setError('Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900 dark:text-white">
            Sign in to your account
          </h2>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 text-red-500 p-3 rounded-md text-sm">
              {error}
            </div>
          )}

          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="email" className="sr-only">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 dark:border-gray-700 placeholder-gray-500 text-gray-900 dark:text-white dark:bg-gray-800 rounded-t-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="Email address"
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 dark:border-gray-700 placeholder-gray-500 text-gray-900 dark:text-white dark:bg-gray-800 rounded-b-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="Password"
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </div>

          <div className="text-center text-sm">
            <span className="text-gray-600 dark:text-gray-400">Don't have an account? </span>
            <Link href="/register" className="text-indigo-600 hover:text-indigo-500">
              Sign up
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
`
      }
    },

    // Step 6: Create register page (conditional)
    {
      id: 'create-register-page',
      name: 'Create Register Page',
      description: 'Create the registration page component',
      type: 'file_create',
      condition: 'params.includeRegister',
      config: {
        path: 'src/app/(auth)/register/page.tsx',
        template: `'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const confirmPassword = formData.get('confirmPassword') as string;

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Registration failed');
      }

      router.push('/login?registered=true');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900 dark:text-white">
            Create your account
          </h2>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 text-red-500 p-3 rounded-md text-sm">
              {error}
            </div>
          )}

          <div className="rounded-md shadow-sm space-y-2">
            <div>
              <label htmlFor="name" className="sr-only">
                Name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                className="appearance-none relative block w-full px-3 py-2 border border-gray-300 dark:border-gray-700 placeholder-gray-500 text-gray-900 dark:text-white dark:bg-gray-800 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="Full name"
              />
            </div>
            <div>
              <label htmlFor="email" className="sr-only">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="appearance-none relative block w-full px-3 py-2 border border-gray-300 dark:border-gray-700 placeholder-gray-500 text-gray-900 dark:text-white dark:bg-gray-800 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="Email address"
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                className="appearance-none relative block w-full px-3 py-2 border border-gray-300 dark:border-gray-700 placeholder-gray-500 text-gray-900 dark:text-white dark:bg-gray-800 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="Password (min 8 characters)"
              />
            </div>
            <div>
              <label htmlFor="confirmPassword" className="sr-only">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                required
                className="appearance-none relative block w-full px-3 py-2 border border-gray-300 dark:border-gray-700 placeholder-gray-500 text-gray-900 dark:text-white dark:bg-gray-800 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="Confirm password"
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              {loading ? 'Creating account...' : 'Create account'}
            </button>
          </div>

          <div className="text-center text-sm">
            <span className="text-gray-600 dark:text-gray-400">Already have an account? </span>
            <Link href="/login" className="text-indigo-600 hover:text-indigo-500">
              Sign in
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
`
      }
    },

    // Step 7: Create register API endpoint
    {
      id: 'create-register-api',
      name: 'Create Register API',
      description: 'Create the registration API endpoint',
      type: 'file_create',
      condition: 'params.includeRegister',
      config: {
        path: 'src/app/api/auth/register/route.ts',
        template: `import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';

export async function POST(req: Request) {
  try {
    const { name, email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'User already exists' },
        { status: 400 }
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword
      }
    });

    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email
    });
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: 'Registration failed' },
      { status: 500 }
    );
  }
}
`
      }
    },

    // Step 8: Create auth layout
    {
      id: 'create-auth-layout',
      name: 'Create Auth Layout',
      description: 'Create layout for auth pages',
      type: 'file_create',
      config: {
        path: 'src/app/(auth)/layout.tsx',
        template: `export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {children}
    </div>
  );
}
`
      }
    },

    // Step 9: Run migration
    {
      id: 'run-migration',
      name: 'Run Database Migration',
      description: 'Apply auth schema changes to database',
      type: 'command',
      config: {
        command: 'npx prisma migrate dev --name add_auth',
        timeout: 120000
      }
    }
  ],

  rollbackSteps: [
    {
      id: 'remove-migration',
      name: 'Remove Migration',
      description: 'Roll back the auth migration',
      type: 'command',
      config: {
        command: 'npx prisma migrate reset --force',
        timeout: 60000
      }
    }
  ]
};

export default authRecipe;
