import { ACCESS_GATE_COOKIE } from '@/lib/auth/access-gate';
import { resolveEffectiveRole } from '@/lib/auth/creator';
import { AuthRepository } from '@/lib/repositories/auth.repository';
import { AuthResult, SessionUser } from '@/lib/repositories/types';
import { Profile } from '@/types/database';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { createSupabaseServerClient } from '../server';

const readSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;
  return { id: user.id, email: user.email };
});

const readCurrentProfile = cache(async (): Promise<Profile | null> => {
  const sessionUser = await readSessionUser();
  if (!sessionUser) return null;

  const supabase = await createSupabaseServerClient();
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', sessionUser.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!profile) return null;

  const role = await resolveEffectiveRole(profile.role, sessionUser.email);
  return {
    ...(profile as Profile),
    role: role ?? profile.role,
  };
});

export class SupabaseAuthRepository implements AuthRepository {
  async signIn(email: string, password: string): Promise<AuthResult> {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  }

  async signOut(): Promise<void> {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
    try {
      const cookieStore = await cookies();
      cookieStore.set(ACCESS_GATE_COOKIE, '', {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 0,
      });
    } catch {
      // Chiqish chaqiruvi cookie yozolmaydigan joydan kelsa, sessiya baribir yopiladi.
    }
  }

  async getSessionUser(): Promise<SessionUser | null> {
    return readSessionUser();
  }

  async getCurrentProfile(): Promise<Profile | null> {
    return readCurrentProfile();
  }
}
