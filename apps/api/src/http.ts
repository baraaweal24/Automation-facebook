import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '@repo/database';

export type AuthenticatedRequest = Request<Record<string, string>> & { user?: { id: string; username: string; email: string }; dashboardSession?: { csrfToken: string } };
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

export async function requireAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.session as string | undefined;
    if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'يرجى تسجيل الدخول.');
    const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    if (!session || session.expiresAt < new Date() || !session.user.isActive) throw new ApiError(401, 'SESSION_EXPIRED', 'انتهت جلسة لوحة التحكم.');
    req.user = { id: session.user.id, username: session.user.username, email: session.user.email };
    req.dashboardSession = { csrfToken: session.csrfToken };
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.header('x-csrf-token') !== session.csrfToken) throw new ApiError(403, 'CSRF_INVALID', 'تعذر التحقق من الطلب. حدّث الصفحة وحاول مجددًا.');
    next();
  } catch (error) { next(error); }
}

export const asyncRoute = (handler: (req: AuthenticatedRequest, res: Response) => unknown | Promise<unknown>) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next);

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
