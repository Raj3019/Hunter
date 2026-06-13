// Lightweight client-side read of the signed-in user from the Supabase JWT in
// localStorage. No new backend call — the token payload already carries email.

function decodeToken(): Record<string, unknown> | null {
  const token = localStorage.getItem("access_token");
  if (!token) return null;
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function currentUserEmail(): string | null {
  const payload = decodeToken();
  if (!payload) return null;
  const meta = (payload.user_metadata as Record<string, unknown> | undefined) || {};
  return (payload.email as string) || (meta.email as string) || null;
}

export function currentUserName(): string | null {
  const payload = decodeToken();
  if (!payload) return null;
  const meta = (payload.user_metadata as Record<string, unknown> | undefined) || {};
  const name = (meta.full_name as string) || (meta.name as string);
  if (name) return name;
  const email = currentUserEmail();
  if (!email) return null;
  // Title-case the local part as a friendly fallback name.
  return email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

export function userInitials(): string {
  const name = currentUserName();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    if (parts[0]) return parts[0].slice(0, 2).toUpperCase();
  }
  const email = currentUserEmail();
  if (!email) return "H";
  const local = email.split("@")[0];
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}
