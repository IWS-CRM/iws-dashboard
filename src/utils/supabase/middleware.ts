import {
  ACCESS_GATE_COOKIE,
  ACCESS_GATE_TTL_SECONDS,
  accessTokenIsFresh,
  authStorageKey,
  gateIsBlocked,
  openAccessGate,
  readLocalAccessToken,
  sealAccessGate,
} from '@/lib/auth/access-gate';
import { resolveEffectiveRole } from '@/lib/auth/creator';
import { getSupabaseEnv } from '@/lib/supabase-env';
import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

type SessionIdentity = { id: string; email?: string | null };

type SessionResult = {
  user: SessionIdentity | null;
  role: string | null;
  response: NextResponse;
  configError: boolean;
  blocked: boolean;
};

function gateCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}

function clearSessionCookies(
  request: NextRequest,
  response: NextResponse,
  supabaseUrl: string
) {
  const storageKey = authStorageKey(supabaseUrl);
  const names = new Set<string>();
  for (const cookie of request.cookies.getAll()) {
    if (!storageKey) break;
    if (
      cookie.name === storageKey ||
      cookie.name.startsWith(`${storageKey}.`) ||
      cookie.name.startsWith(`${storageKey}-`)
    ) {
      names.add(cookie.name);
    }
  }
  for (const name of names) {
    response.cookies.set(name, '', {
      path: '/',
      maxAge: 0,
      sameSite: 'lax',
    });
  }
  response.cookies.set(ACCESS_GATE_COOKIE, '', gateCookieOptions(0));
}

function isRefreshTokenError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String(error.code) : '';
  const message = 'message' in error ? String(error.message) : '';
  return (
    code === 'refresh_token_not_found' ||
    message.toLowerCase().includes('refresh token not found')
  );
}

export async function updateSession(request: NextRequest): Promise<SessionResult> {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const env = getSupabaseEnv();
  if (!env) {
    return {
      user: null,
      role: null,
      response: supabaseResponse,
      configError: true,
      blocked: false,
    };
  }

  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  const localToken = readLocalAccessToken(request.cookies.getAll(), env.url);
  if (secret && localToken && accessTokenIsFresh(localToken)) {
    const gate = await openAccessGate(
      request.cookies.get(ACCESS_GATE_COOKIE)?.value,
      secret
    );
    if (gate && gate.sub === localToken.userId) {
      if (gateIsBlocked(gate)) {
        clearSessionCookies(request, supabaseResponse, env.url);
        return {
          user: null,
          role: null,
          response: supabaseResponse,
          configError: false,
          blocked: true,
        };
      }
      return {
        user: { id: localToken.userId, email: localToken.email },
        role: gate.role,
        response: supabaseResponse,
        configError: false,
        blocked: false,
      };
    }
  }

  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
        Object.entries(headers).forEach(([key, value]) =>
          supabaseResponse.headers.set(key, value)
        );
      },
    },
  });

  let user: SessionIdentity | null = null;
  try {
    const result = await supabase.auth.getUser();
    if (isRefreshTokenError(result.error)) {
      clearSessionCookies(request, supabaseResponse, env.url);
      return {
        user: null,
        role: null,
        response: supabaseResponse,
        configError: false,
        blocked: false,
      };
    }
    if (result.data.user) {
      user = { id: result.data.user.id, email: result.data.user.email };
    }
  } catch (error) {
    if (isRefreshTokenError(error)) {
      clearSessionCookies(request, supabaseResponse, env.url);
      return {
        user: null,
        role: null,
        response: supabaseResponse,
        configError: false,
        blocked: false,
      };
    }
    throw error;
  }

  let role: string | null = null;
  let blocked = false;
  let accessDisabled = false;
  let loginEnabled: boolean | null = null;
  if (user) {
    let profile: { role?: string | null; access_disabled?: boolean | null } | null = null;
    const withAccess = await supabase
      .from('profiles')
      .select('role, access_disabled')
      .eq('id', user.id)
      .maybeSingle();
    if (withAccess.error) {
      const roleOnly = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      profile = roleOnly.data;
    } else {
      profile = withAccess.data;
    }
    const accessUnknown = Boolean(withAccess.error);
    role = await resolveEffectiveRole(profile?.role ?? null, user.email);
    accessDisabled = profile?.access_disabled === true;
    if (role !== 'creator' && (accessUnknown || accessDisabled)) {
      blocked = true;
    }
    if (role === 'worker') {
      const worker = await supabase
        .from('workers')
        .select('login_enabled')
        .eq('user_id', user.id)
        .maybeSingle();
      if (worker.error || worker.data?.login_enabled === false) {
        blocked = true;
        loginEnabled = false;
      } else if (worker.data) {
        loginEnabled = worker.data.login_enabled !== false;
      }
    }
  }

  if (blocked) {
    await supabase.auth.signOut();
    clearSessionCookies(request, supabaseResponse, env.url);
    return {
      user: null,
      role: null,
      response: supabaseResponse,
      configError: false,
      blocked: true,
    };
  }

  if (user && secret) {
    const sealed = await sealAccessGate(
      {
        sub: user.id,
        email: user.email ?? null,
        role,
        accessDisabled,
        loginEnabled,
      },
      secret
    );
    supabaseResponse.cookies.set(
      ACCESS_GATE_COOKIE,
      sealed,
      gateCookieOptions(ACCESS_GATE_TTL_SECONDS)
    );
  } else if (!user) {
    supabaseResponse.cookies.set(ACCESS_GATE_COOKIE, '', gateCookieOptions(0));
  }

  return {
    user,
    role,
    response: supabaseResponse,
    configError: false,
    blocked: false,
  };
}
