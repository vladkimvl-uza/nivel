import { redirect } from "next/navigation";

// The sign-in moved to /sign-in (WP-10); old bookmarks keep working.
export default function LegacyLoginPage() {
  redirect("/sign-in");
}
