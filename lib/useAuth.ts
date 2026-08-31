"use client";

import { useEffect, useState } from "react";

import { supabaseBrowser } from "@/lib/supabaseBrowser";

/**
 * Who is signed in, for the parts of the UI that need to know.
 *
 * The middleware has already refused anyone without a session by the time a
 * page renders, so inside the app `userId` is effectively always set. This
 * exists to *name* that person — for the account line in the masthead, for
 * stamping samples, and for handing the polling tile protocol a token — not to
 * decide whether they may be here.
 *
 * `status` starts as "loading" for the one tick it takes to read the session
 * back, so nothing renders a signed-out state that is about to be wrong.
 */
export type AuthState = {
  status: "loading" | "in" | "out";
  userId: string | null;
  email: string | null;
  /** Read by the polling tile protocol; refreshed automatically by the client. */
  accessToken: string | null;
};

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    status: "loading",
    userId: null,
    email: null,
    accessToken: null,
  });

  useEffect(() => {
    const client = supabaseBrowser();
    if (!client) {
      setState({ status: "out", userId: null, email: null, accessToken: null });
      return;
    }

    const adopt = (session: { access_token: string; user: { id: string; email?: string } } | null) =>
      setState(
        session
          ? {
              status: "in",
              userId: session.user.id,
              email: session.user.email ?? null,
              accessToken: session.access_token,
            }
          : { status: "out", userId: null, email: null, accessToken: null },
      );

    client.auth.getSession().then(({ data }) => adopt(data.session));

    // Fires on refresh as well as sign-in/out, which is what keeps the polling
    // token from going stale on a long survey day.
    const { data: sub } = client.auth.onAuthStateChange((_event, session) => adopt(session));
    return () => sub.subscription.unsubscribe();
  }, []);

  return state;
}

/**
 * Sign out and go to the login page.
 *
 * A full page navigation rather than a router push: signing out invalidates
 * the cookie the middleware reads, and a client-side transition would leave
 * server-rendered data from the old session on screen.
 */
export async function signOut() {
  await supabaseBrowser()?.auth.signOut();
  window.location.href = "/login";
}
