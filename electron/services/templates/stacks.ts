/**
 * Stack Templates Configuration
 *
 * Defines available technology stacks for project generation.
 */

import { StackConfig, FolderStructure } from '../agent/types';

/**
 * Next.js + Prisma + PostgreSQL Stack
 */
export const STACK_NEXTJS_PRISMA: StackConfig = {
  id: 'nextjs-prisma',
  name: 'Next.js + Prisma + PostgreSQL',
  description: 'Full-stack React with server components, Prisma ORM, and PostgreSQL',

  frontend: {
    framework: 'next',
    styling: 'tailwind',
    stateManagement: 'zustand'
  },

  backend: {
    runtime: 'node',
    framework: 'next-api',
    auth: 'next-auth'
  },

  database: {
    type: 'postgresql',
    orm: 'prisma'
  },

  structure: {
    'src': {
      'app': {
        'layout.tsx': 'Root layout with providers',
        'page.tsx': 'Home page',
        'globals.css': 'Global styles',
        'api': {
          'auth': {
            '[...nextauth]': {
              'route.ts': 'NextAuth handler'
            }
          }
        },
        '(auth)': {
          'login': {
            'page.tsx': 'Login page'
          },
          'register': {
            'page.tsx': 'Register page'
          }
        }
      },
      'components': {
        'ui': 'Reusable UI components',
        'forms': 'Form components',
        'layouts': 'Layout components'
      },
      'lib': {
        'prisma.ts': 'Prisma client singleton',
        'auth.ts': 'Auth configuration',
        'utils.ts': 'Utility functions'
      },
      'hooks': 'Custom React hooks',
      'types': 'TypeScript type definitions'
    },
    'prisma': {
      'schema.prisma': 'Database schema',
      'seed.ts': 'Database seeding script'
    },
    'public': 'Static assets',
    '.env': 'Environment variables',
    '.env.example': 'Example environment variables',
    'package.json': 'Node dependencies',
    'tsconfig.json': 'TypeScript configuration',
    'tailwind.config.ts': 'Tailwind configuration',
    'next.config.js': 'Next.js configuration'
  },

  commands: {
    install: 'npm install',
    dev: 'npm run dev',
    build: 'npm run build',
    test: 'npm test',
    migrate: 'npx prisma migrate dev',
    seed: 'npx prisma db seed',
    lint: 'npm run lint',
    format: 'npm run format'
  },

  ports: {
    dev: 3000,
    database: 5432
  },

  templates: {
    'package.json': `{
  "name": "{{projectName}}",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "jest"
  },
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@prisma/client": "^5.0.0",
    "next-auth": "^4.24.0",
    "zustand": "^4.4.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.2.0",
    "typescript": "^5.0.0",
    "prisma": "^5.0.0",
    "tailwindcss": "^3.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0"
  }
}`,
    'prisma/schema.prisma': `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}`,
    '.env.example': `DATABASE_URL="postgresql://user:password@localhost:5432/mydb"
NEXTAUTH_SECRET="your-secret-here"
NEXTAUTH_URL="http://localhost:3000"`
  }
};

/**
 * Express + Drizzle + PostgreSQL Stack
 */
export const STACK_EXPRESS_POSTGRES: StackConfig = {
  id: 'express-postgres',
  name: 'Express + TypeScript + PostgreSQL',
  description: 'Traditional REST API with Express and Drizzle ORM',

  frontend: {
    framework: 'react',
    styling: 'tailwind'
  },

  backend: {
    runtime: 'node',
    framework: 'express',
    auth: 'lucia'
  },

  database: {
    type: 'postgresql',
    orm: 'drizzle'
  },

  structure: {
    'src': {
      'api': {
        'routes': 'Route definitions',
        'controllers': 'Request handlers',
        'middleware': 'Express middleware',
        'validators': 'Request validation schemas'
      },
      'services': 'Business logic layer',
      'db': {
        'schema.ts': 'Drizzle schema',
        'index.ts': 'Database connection',
        'migrations': 'SQL migrations'
      },
      'lib': 'Utility modules',
      'types': 'TypeScript types',
      'index.ts': 'Application entry point'
    },
    'client': {
      'src': {
        'components': 'React components',
        'pages': 'Page components',
        'hooks': 'Custom hooks',
        'api': 'API client'
      },
      'package.json': 'Client dependencies'
    },
    '.env': 'Environment variables',
    '.env.example': 'Example environment variables',
    'package.json': 'Server dependencies',
    'tsconfig.json': 'TypeScript configuration'
  },

  commands: {
    install: 'npm install && cd client && npm install',
    dev: 'npm run dev',
    build: 'npm run build',
    test: 'npm test',
    migrate: 'npx drizzle-kit push:pg',
    lint: 'npm run lint'
  },

  ports: {
    dev: 3001,
    database: 5432
  }
};

/**
 * FastAPI + React + PostgreSQL Stack
 */
export const STACK_FASTAPI_REACT: StackConfig = {
  id: 'fastapi-react',
  name: 'FastAPI + React + PostgreSQL',
  description: 'Python backend with React frontend',

  frontend: {
    framework: 'react',
    styling: 'tailwind',
    stateManagement: 'zustand'
  },

  backend: {
    runtime: 'python',
    framework: 'fastapi'
  },

  database: {
    type: 'postgresql',
    orm: 'sqlalchemy'
  },

  structure: {
    'backend': {
      'app': {
        'main.py': 'FastAPI application entry',
        'api': {
          'routes': 'API route modules',
          'deps.py': 'Dependency injection'
        },
        'models': 'SQLAlchemy models',
        'schemas': 'Pydantic schemas',
        'services': 'Business logic',
        'db': {
          'base.py': 'Database base',
          'session.py': 'Session management'
        },
        'core': {
          'config.py': 'Application configuration',
          'security.py': 'Authentication utilities'
        }
      },
      'alembic': {
        'versions': 'Migration files',
        'env.py': 'Alembic environment'
      },
      'tests': 'Python tests',
      'requirements.txt': 'Python dependencies',
      'pyproject.toml': 'Project configuration'
    },
    'frontend': {
      'src': {
        'components': 'React components',
        'pages': 'Page components',
        'hooks': 'Custom hooks',
        'api': 'API client (fetch/axios)',
        'App.tsx': 'Root component',
        'main.tsx': 'Entry point'
      },
      'package.json': 'Node dependencies',
      'vite.config.ts': 'Vite configuration'
    }
  },

  commands: {
    install: 'pip install -r backend/requirements.txt && cd frontend && npm install',
    dev: 'uvicorn backend.app.main:app --reload & cd frontend && npm run dev',
    build: 'cd frontend && npm run build',
    test: 'pytest backend/tests && cd frontend && npm test',
    migrate: 'alembic upgrade head'
  },

  ports: {
    dev: 8000,
    database: 5432
  }
};

/**
 * Simple React + Express API Stack (for simpler projects)
 */
export const STACK_REACT_EXPRESS_SIMPLE: StackConfig = {
  id: 'react-express-simple',
  name: 'React + Express (Simple)',
  description: 'Simple full-stack setup without database ORM',

  frontend: {
    framework: 'react',
    styling: 'tailwind'
  },

  backend: {
    runtime: 'node',
    framework: 'express'
  },

  database: {
    type: 'sqlite',
    orm: 'none'
  },

  structure: {
    'server': {
      'index.js': 'Express server',
      'routes': 'API routes',
      'data': 'JSON data files'
    },
    'client': {
      'src': {
        'components': 'React components',
        'App.jsx': 'Root component',
        'main.jsx': 'Entry point'
      },
      'index.html': 'HTML template',
      'package.json': 'Client dependencies',
      'vite.config.js': 'Vite configuration'
    },
    'package.json': 'Root dependencies'
  },

  commands: {
    install: 'npm install && cd client && npm install',
    dev: 'npm run dev',
    build: 'npm run build',
    test: 'npm test'
  },

  ports: {
    dev: 5173
  }
};

/**
 * All available stacks
 */
export const AVAILABLE_STACKS: StackConfig[] = [
  STACK_NEXTJS_PRISMA,
  STACK_EXPRESS_POSTGRES,
  STACK_FASTAPI_REACT,
  STACK_REACT_EXPRESS_SIMPLE
];

/**
 * Get stack by ID
 */
export function getStackById(id: string): StackConfig | undefined {
  return AVAILABLE_STACKS.find(stack => stack.id === id);
}

/**
 * Get default stack
 */
export function getDefaultStack(): StackConfig {
  return STACK_NEXTJS_PRISMA;
}

/**
 * Get stacks filtered by criteria
 */
export function getStacksBy(criteria: {
  frontend?: string;
  backend?: string;
  database?: string;
}): StackConfig[] {
  return AVAILABLE_STACKS.filter(stack => {
    if (criteria.frontend && stack.frontend.framework !== criteria.frontend) {
      return false;
    }
    if (criteria.backend && stack.backend.framework !== criteria.backend) {
      return false;
    }
    if (criteria.database && stack.database.type !== criteria.database) {
      return false;
    }
    return true;
  });
}

/**
 * Flatten folder structure to file paths
 */
export function flattenStructure(
  structure: FolderStructure,
  basePath = ''
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(structure)) {
    const currentPath = basePath ? `${basePath}/${key}` : key;

    if (typeof value === 'string') {
      result[currentPath] = value;
    } else {
      Object.assign(result, flattenStructure(value, currentPath));
    }
  }

  return result;
}

export default AVAILABLE_STACKS;
