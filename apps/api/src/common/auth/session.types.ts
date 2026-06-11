export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  image?: string | null;
  plan?: string | null;
  adminRole?: string | null;
}

export interface AuthSession {
  id: string;
  token: string;
  userId: string;
  expiresAt: string | Date;
}

export interface AuthContext {
  user: AuthUser;
  session: AuthSession;
}
