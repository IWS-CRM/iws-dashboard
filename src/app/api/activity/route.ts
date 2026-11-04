import { pingActivity } from '@/lib/api/activity';
import { accessTokenIsFresh, readLocalAccessToken } from '@/lib/auth/access-gate';
import { resolveEffectiveRole } from '@/lib/auth/creator';
import { createSupabaseServerClient } from '@/lib/providers/supabase/server';
import { getSupabaseEnv } from '@/lib/supabase-env';
import { cookies } from 'next/headers';

export async function POST() {
  const env = getSupabaseEnv();
  if (!env) return new Response(null, { status: 204 });

  const cookieStore = await cookies();
  const session = readLocalAccessToken(cookieStore.getAll(), env.url);
  if (!session || !accessTokenIsFresh(session)) {
    return new Response(null, { status: 204 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('id', session.userId)
      .maybeSingle();
    if (error || !data) return new Response(null, { status: 204 });

    const role = await resolveEffectiveRole(data.role, session.email);
    if (!role) return new Response(null, { status: 204 });

    await pingActivity({
      id: data.id,
      full_name: data.full_name,
      role,
    });
  } catch {
    // Faollik yozuvi sahifa o'tishini to'xtatmasligi kerak.
  }

  return new Response(null, { status: 204 });
}
