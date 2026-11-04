import { ActivityHeartbeat } from '@/components/layout/activity-heartbeat';
import { pingActivity } from '@/lib/actions/activity';

// Tabs opened before the heartbeat moved to /api/activity still call this action.
void pingActivity;
import { signOut } from '@/lib/actions/auth';
import { requirePageRole } from '@/lib/auth/require-role';
import { USER_ROLE_LABELS } from '@/types/database';
import { LogOut } from 'lucide-react';
import { redirect } from 'next/navigation';

export default async function WorkerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requirePageRole(['worker']);

  return (
    <div className="min-h-screen bg-slate-50">
      <ActivityHeartbeat />
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white">
              IWS
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{profile.full_name}</p>
              <p className="text-xs text-slate-500">{USER_ROLE_LABELS.worker}</p>
            </div>
          </div>
          <form
            action={async () => {
              'use server';
              await signOut();
              redirect('/login');
            }}
          >
            <button
              type="submit"
              aria-label="Chiqish"
              className="inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Chiqish</span>
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
