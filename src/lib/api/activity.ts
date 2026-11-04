import { createSupabaseAdminClient } from '@/lib/providers/supabase/admin';
import { ActivityPing, UserRole } from '@/types/database';

type ActivitySubject = {
  id: string;
  full_name: string;
  role: UserRole;
};

function isMissingTable(error: { message?: string; code?: string } | null) {
  if (!error) return false;
  const text = `${error.code ?? ''} ${error.message ?? ''}`.toLowerCase();
  return (
    text.includes('activity_pings') ||
    text.includes('does not exist') ||
    text.includes('schema cache')
  );
}

export async function pingActivity(profile: ActivitySubject) {
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from('activity_pings').upsert(
      {
        user_id: profile.id,
        full_name: profile.full_name,
        role: profile.role,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
    if (error && !isMissingTable(error)) {
      console.error('activity_pings upsert', error.message);
    }
  } catch {
    //
  }
}

export async function getActivityPings(): Promise<ActivityPing[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('activity_pings')
    .select('*')
    .order('last_seen_at', { ascending: false });

  if (error && isMissingTable(error)) return [];
  if (error) throw error;
  return (data || []) as ActivityPing[];
}
