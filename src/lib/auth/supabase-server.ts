import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Server-side Supabase client scoped to the current request's cookies.
 *
 * Usage from API routes / Server Components / Route Handlers:
 *   const supabase = await getSupabaseServer();
 *   const { data: { user } } = await supabase.auth.getUser();
 *
 * The setAll handler silently ignores failures so Server Components (which
 * can't mutate cookies) don't crash; token refresh happens in middleware instead.
 */
export async function getSupabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(toSet) {
          try {
            for (const { name, value, options } of toSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components can't set cookies; middleware refreshes tokens there.
          }
        },
      },
    },
  );
}
