import type { ReactNode } from "react";
import { requireUser } from "../../src/auth/next.ts";
import { Shell } from "../../src/nav/Shell.tsx";

export const dynamic = "force-dynamic";

export default async function JournalLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return <Shell user={user}>{children}</Shell>;
}
