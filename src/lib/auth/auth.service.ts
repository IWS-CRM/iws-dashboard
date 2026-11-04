import { getAuthRepository } from '@/lib/providers';
import { AuthResult } from '@/lib/repositories/types';
import { Profile } from '@/types/database';
import { cache } from 'react';

/**
 * Autentifikatsiya qatlami — kelajakda Supabase Auth o'rniga
 * boshqa usul ulansa, faqat provider implementatsiyasi o'zgaradi.
 */

export async function signIn(
  email: string,
  password: string
): Promise<AuthResult> {
  return getAuthRepository().signIn(email, password);
}

export async function signOut(): Promise<void> {
  return getAuthRepository().signOut();
}

export const getSessionUser = cache(async () => {
  return getAuthRepository().getSessionUser();
});

export const getCurrentUser = cache(async (): Promise<Profile | null> => {
  return getAuthRepository().getCurrentProfile();
});

export async function isAuthenticated(): Promise<boolean> {
  const user = await getSessionUser();
  return user !== null;
}
