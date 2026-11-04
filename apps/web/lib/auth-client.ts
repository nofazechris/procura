"use client";

import { createAuthClient } from "better-auth/react";

/** Browser-side auth client. Contains no secrets; it only talks to /api/auth/*. */
export const authClient = createAuthClient();
export const { signIn, signUp, signOut, useSession } = authClient;
