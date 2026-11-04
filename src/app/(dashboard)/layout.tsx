import { AppShell } from '@/components/layout/app-shell';
import { getCurrentUser, getSessionUser, signOut } from '@/lib/actions/auth';
import { redirect } from 'next/navigation';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let profile = null;
  try {
    profile = await getCurrentUser();
  } catch {
    profile = null;
  }

  if (!profile) {
    const session = await getSessionUser();
    if (!session) {
      redirect('/login');
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center">
          <h1 className="text-lg font-semibold text-slate-900">Profil topilmadi</h1>
          <p className="mt-3 text-sm text-slate-600">
            Hisobingiz autentifikatsiyadan o‘tgan, lekin <code>profiles</code> jadvalida
            yozuv yo‘q. Superadmin migratsiyalarni tekshirsin yoki foydalanuvchini qayta
            yaratsin.
          </p>
          <form
            className="mt-6"
            action={async () => {
              'use server';
              await signOut();
              redirect('/login');
            }}
          >
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Chiqish
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (profile.role === 'worker') {
    redirect('/my');
  }

  return (
    <AppShell userRole={profile.role} userName={profile.full_name}>
      {children}
    </AppShell>
  );
}
