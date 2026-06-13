type StoredUserProfile = {
  userId?: string;
  email?: string;
  fullName?: string;
};

const PROFILE_STORAGE_KEY = "hunter_user_profile";

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

function text(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function tokenEmailValue(): string | null {
  const payload = decodeToken();
  if (!payload) return null;
  const meta = (payload.user_metadata as Record<string, unknown> | undefined) || {};
  return text(payload.email) || text(meta.email) || null;
}

function readStoredProfile(): StoredUserProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const profile = JSON.parse(raw) as StoredUserProfile;
    const tokenEmail = tokenEmailValue();
    if (profile.email && tokenEmail && profile.email.toLowerCase() !== tokenEmail.toLowerCase()) {
      localStorage.removeItem(PROFILE_STORAGE_KEY);
      return null;
    }
    return profile;
  } catch {
    localStorage.removeItem(PROFILE_STORAGE_KEY);
    return null;
  }
}

export function setCurrentUserProfile(profile: StoredUserProfile): void {
  const current = readStoredProfile() || {};
  const hasFullName = Object.prototype.hasOwnProperty.call(profile, "fullName");
  const next = {
    ...current,
    ...profile,
    email: profile.email || current.email || tokenEmailValue() || undefined,
    fullName: hasFullName ? profile.fullName || undefined : current.fullName || undefined,
  };
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(next));
}

export function clearCurrentUserProfile(): void {
  localStorage.removeItem(PROFILE_STORAGE_KEY);
}

export function currentUserEmail(): string | null {
  const stored = readStoredProfile();
  return stored?.email || tokenEmailValue();
}

export function currentUserName(): string | null {
  const stored = readStoredProfile();
  if (stored?.fullName) return stored.fullName;

  const payload = decodeToken();
  if (!payload) return null;
  const meta = (payload.user_metadata as Record<string, unknown> | undefined) || {};
  const name = text(meta.full_name) || text(meta.name);
  if (name) return name;

  const email = currentUserEmail();
  if (!email) return null;
  return email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function userInitials(nameOverride?: string | null): string {
  const name = nameOverride || currentUserName();
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
