/**
 * CRUD Recipe
 *
 * Generates CRUD operations for a Prisma model
 */

import type { Recipe } from '../types';

export const crudRecipe: Recipe = {
  id: 'add-crud',
  name: 'Add CRUD for Model',
  description: 'Generate complete CRUD operations (Create, Read, Update, Delete) for a Prisma model',
  category: 'api',
  icon: 'database',
  tags: ['crud', 'api', 'model', 'prisma', 'rest'],
  compatibleStacks: ['nextjs-prisma'],
  version: '1.0.0',
  author: 'Singularity',

  parameters: [
    {
      name: 'modelName',
      type: 'string',
      label: 'Model Name',
      description: 'The Prisma model name (e.g., "Post", "Product")',
      required: true,
      validation: {
        pattern: '^[A-Z][a-zA-Z0-9]*$',
        minLength: 2,
        maxLength: 50
      }
    },
    {
      name: 'pluralName',
      type: 'string',
      label: 'Plural Name',
      description: 'The plural form for routes (e.g., "posts", "products")',
      required: true,
      validation: {
        pattern: '^[a-z][a-zA-Z0-9]*$',
        minLength: 2,
        maxLength: 50
      }
    },
    {
      name: 'includeUI',
      type: 'boolean',
      label: 'Include UI Pages',
      description: 'Generate list and detail pages',
      required: false,
      default: true
    },
    {
      name: 'includeForm',
      type: 'boolean',
      label: 'Include Form Component',
      description: 'Generate create/edit form component',
      required: false,
      default: true
    }
  ],

  steps: [
    // Step 1: Create API route handler
    {
      id: 'create-api-route',
      name: 'Create API Route',
      description: 'Create the main CRUD API route',
      type: 'file_create',
      config: {
        path: 'src/app/api/{{pluralName}}/route.ts',
        template: `import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// GET all {{pluralName}}
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const search = searchParams.get('search') || '';

    const skip = (page - 1) * limit;

    const where = search
      ? {
          OR: [
            // Add searchable fields here based on your model
            // { name: { contains: search, mode: 'insensitive' } },
          ]
        }
      : {};

    const [items, total] = await Promise.all([
      prisma.{{modelNameLower}}.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.{{modelNameLower}}.count({ where })
    ]);

    return NextResponse.json({
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching {{pluralName}}:', error);
    return NextResponse.json(
      { error: 'Failed to fetch {{pluralName}}' },
      { status: 500 }
    );
  }
}

// POST create new {{modelName}}
export async function POST(request: Request) {
  try {
    const body = await request.json();

    const item = await prisma.{{modelNameLower}}.create({
      data: body
    });

    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    console.error('Error creating {{modelName}}:', error);
    return NextResponse.json(
      { error: 'Failed to create {{modelName}}' },
      { status: 500 }
    );
  }
}
`
      }
    },

    // Step 2: Create single item API route
    {
      id: 'create-single-api-route',
      name: 'Create Single Item API Route',
      description: 'Create API route for single item operations',
      type: 'file_create',
      config: {
        path: 'src/app/api/{{pluralName}}/[id]/route.ts',
        template: `import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

interface RouteParams {
  params: { id: string };
}

// GET single {{modelName}}
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const item = await prisma.{{modelNameLower}}.findUnique({
      where: { id: params.id }
    });

    if (!item) {
      return NextResponse.json(
        { error: '{{modelName}} not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(item);
  } catch (error) {
    console.error('Error fetching {{modelName}}:', error);
    return NextResponse.json(
      { error: 'Failed to fetch {{modelName}}' },
      { status: 500 }
    );
  }
}

// PUT update {{modelName}}
export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const body = await request.json();

    const item = await prisma.{{modelNameLower}}.update({
      where: { id: params.id },
      data: body
    });

    return NextResponse.json(item);
  } catch (error: any) {
    if (error.code === 'P2025') {
      return NextResponse.json(
        { error: '{{modelName}} not found' },
        { status: 404 }
      );
    }
    console.error('Error updating {{modelName}}:', error);
    return NextResponse.json(
      { error: 'Failed to update {{modelName}}' },
      { status: 500 }
    );
  }
}

// PATCH partial update {{modelName}}
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const body = await request.json();

    const item = await prisma.{{modelNameLower}}.update({
      where: { id: params.id },
      data: body
    });

    return NextResponse.json(item);
  } catch (error: any) {
    if (error.code === 'P2025') {
      return NextResponse.json(
        { error: '{{modelName}} not found' },
        { status: 404 }
      );
    }
    console.error('Error updating {{modelName}}:', error);
    return NextResponse.json(
      { error: 'Failed to update {{modelName}}' },
      { status: 500 }
    );
  }
}

// DELETE {{modelName}}
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    await prisma.{{modelNameLower}}.delete({
      where: { id: params.id }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.code === 'P2025') {
      return NextResponse.json(
        { error: '{{modelName}} not found' },
        { status: 404 }
      );
    }
    console.error('Error deleting {{modelName}}:', error);
    return NextResponse.json(
      { error: 'Failed to delete {{modelName}}' },
      { status: 500 }
    );
  }
}
`
      }
    },

    // Step 3: Create list page (conditional)
    {
      id: 'create-list-page',
      name: 'Create List Page',
      description: 'Create the list page component',
      type: 'file_create',
      condition: 'params.includeUI',
      config: {
        path: 'src/app/{{pluralName}}/page.tsx',
        template: `'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface {{modelName}} {
  id: string;
  createdAt: string;
  updatedAt: string;
  // Add your model fields here
}

interface PaginatedResponse {
  items: {{modelName}}[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export default function {{modelName}}ListPage() {
  const [data, setData] = useState<PaginatedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetchData();
  }, [page]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const response = await fetch(\`/api/{{pluralName}}?page=\${page}&limit=10\`);
      if (!response.ok) throw new Error('Failed to fetch');
      const json = await response.json();
      setData(json);
    } catch (err) {
      setError('Failed to load {{pluralName}}');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return;

    try {
      const response = await fetch(\`/api/{{pluralName}}/\${id}\`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Failed to delete');
      fetchData();
    } catch {
      alert('Failed to delete item');
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center text-red-500">{error}</div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          {{modelName}}s
        </h1>
        <Link
          href="/{{pluralName}}/new"
          className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
        >
          Add New
        </Link>
      </div>

      <div className="bg-white dark:bg-gray-800 shadow rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                ID
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Created
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {data?.items.map((item) => (
              <tr key={item.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                  {item.id}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {new Date(item.createdAt).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                  <Link
                    href={\`/{{pluralName}}/\${item.id}\`}
                    className="text-indigo-600 hover:text-indigo-900"
                  >
                    View
                  </Link>
                  <Link
                    href={\`/{{pluralName}}/\${item.id}/edit\`}
                    className="text-blue-600 hover:text-blue-900"
                  >
                    Edit
                  </Link>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="text-red-600 hover:text-red-900"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.pagination.totalPages > 1 && (
        <div className="flex justify-center mt-6 space-x-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1 border rounded disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-3 py-1">
            Page {page} of {data.pagination.totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(data.pagination.totalPages, p + 1))}
            disabled={page === data.pagination.totalPages}
            className="px-3 py-1 border rounded disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
`
      }
    },

    // Step 4: Create detail page (conditional)
    {
      id: 'create-detail-page',
      name: 'Create Detail Page',
      description: 'Create the detail page component',
      type: 'file_create',
      condition: 'params.includeUI',
      config: {
        path: 'src/app/{{pluralName}}/[id]/page.tsx',
        template: `'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface {{modelName}} {
  id: string;
  createdAt: string;
  updatedAt: string;
  // Add your model fields here
}

export default function {{modelName}}DetailPage() {
  const params = useParams();
  const router = useRouter();
  const [item, setItem] = useState<{{modelName}} | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (params.id) {
      fetchItem();
    }
  }, [params.id]);

  const fetchItem = async () => {
    try {
      setLoading(true);
      const response = await fetch(\`/api/{{pluralName}}/\${params.id}\`);
      if (!response.ok) throw new Error('Not found');
      const data = await response.json();
      setItem(data);
    } catch {
      setError('Failed to load {{modelName}}');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this item?')) return;

    try {
      const response = await fetch(\`/api/{{pluralName}}/\${params.id}\`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Failed to delete');
      router.push('/{{pluralName}}');
    } catch {
      alert('Failed to delete item');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="p-8 text-center text-red-500">{error || 'Not found'}</div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          {{modelName}} Details
        </h1>
        <div className="space-x-2">
          <Link
            href={\`/{{pluralName}}/\${item.id}/edit\`}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Edit
          </Link>
          <button
            onClick={handleDelete}
            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
        <dl className="divide-y divide-gray-200 dark:divide-gray-700">
          <div className="py-3 flex justify-between">
            <dt className="text-sm font-medium text-gray-500">ID</dt>
            <dd className="text-sm text-gray-900 dark:text-white">{item.id}</dd>
          </div>
          <div className="py-3 flex justify-between">
            <dt className="text-sm font-medium text-gray-500">Created</dt>
            <dd className="text-sm text-gray-900 dark:text-white">
              {new Date(item.createdAt).toLocaleString()}
            </dd>
          </div>
          <div className="py-3 flex justify-between">
            <dt className="text-sm font-medium text-gray-500">Updated</dt>
            <dd className="text-sm text-gray-900 dark:text-white">
              {new Date(item.updatedAt).toLocaleString()}
            </dd>
          </div>
          {/* Add more fields here */}
        </dl>
      </div>

      <div className="mt-4">
        <Link
          href="/{{pluralName}}"
          className="text-indigo-600 hover:text-indigo-900"
        >
          &larr; Back to list
        </Link>
      </div>
    </div>
  );
}
`
      }
    },

    // Step 5: Create form component (conditional)
    {
      id: 'create-form-component',
      name: 'Create Form Component',
      description: 'Create reusable form component',
      type: 'file_create',
      condition: 'params.includeForm',
      config: {
        path: 'src/components/{{modelName}}Form.tsx',
        template: `'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface {{modelName}}FormProps {
  initialData?: Partial<{{modelName}}Data>;
  mode: 'create' | 'edit';
  id?: string;
}

interface {{modelName}}Data {
  // Add your model fields here
  // name: string;
  // description: string;
}

export default function {{modelName}}Form({ initialData, mode, id }: {{modelName}}FormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());

    try {
      const url = mode === 'create'
        ? '/api/{{pluralName}}'
        : \`/api/{{pluralName}}/\${id}\`;

      const response = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Failed to save');
      }

      const result = await response.json();
      router.push(\`/{{pluralName}}/\${result.id}\`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 text-red-500 p-3 rounded-md text-sm">
          {error}
        </div>
      )}

      {/* Add your form fields here */}
      {/* Example:
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Name
        </label>
        <input
          type="text"
          id="name"
          name="name"
          defaultValue={initialData?.name}
          required
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-800 dark:border-gray-700"
        />
      </div>
      */}

      <div className="flex justify-end space-x-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? 'Saving...' : mode === 'create' ? 'Create' : 'Update'}
        </button>
      </div>
    </form>
  );
}
`
      }
    },

    // Step 6: Create new item page
    {
      id: 'create-new-page',
      name: 'Create New Item Page',
      description: 'Create the new item page',
      type: 'file_create',
      condition: 'params.includeForm',
      config: {
        path: 'src/app/{{pluralName}}/new/page.tsx',
        template: `import {{modelName}}Form from '@/components/{{modelName}}Form';

export default function New{{modelName}}Page() {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
        Create New {{modelName}}
      </h1>
      <div className="max-w-2xl">
        <{{modelName}}Form mode="create" />
      </div>
    </div>
  );
}
`
      }
    },

    // Step 7: Create edit page
    {
      id: 'create-edit-page',
      name: 'Create Edit Page',
      description: 'Create the edit item page',
      type: 'file_create',
      condition: 'params.includeForm',
      config: {
        path: 'src/app/{{pluralName}}/[id]/edit/page.tsx',
        template: `'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import {{modelName}}Form from '@/components/{{modelName}}Form';

export default function Edit{{modelName}}Page() {
  const params = useParams();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (params.id) {
      fetch(\`/api/{{pluralName}}/\${params.id}\`)
        .then(res => res.json())
        .then(data => {
          setItem(data);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (!item) {
    return <div className="p-8 text-center text-red-500">Not found</div>;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
        Edit {{modelName}}
      </h1>
      <div className="max-w-2xl">
        <{{modelName}}Form mode="edit" id={params.id as string} initialData={item} />
      </div>
    </div>
  );
}
`
      }
    }
  ]
};

export default crudRecipe;
