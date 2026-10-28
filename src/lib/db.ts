import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let _client: NeonQueryFunction<false, false> | null = null;

function getClient(): NeonQueryFunction<false, false> {
  if (!_client) {
    // Supports standard Neon and Vercel's native Neon Postgres integration variables
    const url =
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.DATABASE_URL_UNPOOLED ||
      process.env.POSTGRES_URL_NON_POOLING;

    if (!url) {
      throw new Error(
        'Database connection string not found. Please ensure DATABASE_URL or POSTGRES_URL is configured.',
      );
    }
    const cleanUrl = url.trim().replace(/^['"]|['"]$/g, '');
    _client = neon(cleanUrl);
  }
  return _client;
}

/**
 * Execute a parameterised SQL query against Neon DB.
 *
 * @example
 *   const rows = await db('SELECT * FROM users WHERE id = $1', [userId])
 */
export async function db<T = Record<string, unknown>>(
  query: string,
  params?: unknown[],
): Promise<T[]> {
  const sql = getClient();
  const rows = await sql.query(query, params);
  return rows as T[];
}

/**
 * Extract the client IP address from incoming request headers for security audit logging.
 */
export function getClientIp(request?: Request): string | null {
  if (!request) return null;
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0]?.trim();
    if (firstIp) return firstIp;
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  return realIp || null;
}
