export type AdminIdentity = {
  email: string;
  role: "admin";
};

export type AuthResult =
  | { authenticated: true; user: AdminIdentity }
  | { authenticated: false };

export type LoginResult =
  | { ok: true; token: string; user: AdminIdentity; expiresAt: number }
  | { ok: false; reason: "not_configured" | "already_configured" | "invalid_credentials" };

export type LinkInput = {
  slug: string;
  target: string;
  description: string | null;
  expiresAt: number | null;
  owner: string;
  createdAt: number;
};

export type LinkRecord = LinkInput & {
  visitCount: number;
  updatedAt: number;
};

export type LinkIndexRecord = Omit<LinkRecord, "visitCount">;

export type LinkUpdate = {
  target?: string;
  description?: string | null;
  expiresAt?: number | null;
  updatedAt: number;
};

export type VisitMetadata = {
  day: string;
  country: string;
  browser: string;
  referrer: string;
};

export type VisitResult =
  | { status: "active"; target: string }
  | { status: "missing" }
  | { status: "expired" };

export type LinkStats = {
  total: number;
  daily: Array<{ day: string; count: number }>;
  countries: Array<{ value: string; count: number }>;
  browsers: Array<{ value: string; count: number }>;
  referrers: Array<{ value: string; count: number }>;
};
