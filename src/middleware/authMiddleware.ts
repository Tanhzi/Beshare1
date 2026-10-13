// src/middleware/authMiddleware.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import supabase from '../config/db';

export interface AuthRequest extends Request {
  user?: any;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const protect = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const header = req.headers.authorization;

  // Scheme "Bearer" không phân biệt hoa thường (RFC 6750)
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    res.status(401).json({ message: 'Not authorized, no token' });
    return;
  }

  const token = header.split(' ')[1];
  if (!token) {
    res.status(401).json({ message: 'Not authorized, no token' });
    return;
  }

  let decoded: jwt.JwtPayload;
  try {
    const result = jwt.verify(token, process.env.JWT_SECRET as string);
    if (typeof result === 'string') {
      res.status(401).json({ message: 'Not authorized, token failed' });
      return;
    }
    decoded = result;
  } catch {
    res.status(401).json({ message: 'Not authorized, token failed' });
    return;
  }

  // Validate payload: phải có id là UUID hợp lệ
  if (!decoded || typeof decoded.id !== 'string' || !UUID_RE.test(decoded.id)) {
    res.status(401).json({ message: 'Not authorized, token failed' });
    return;
  }

  // Kiểm tra thu hồi token (token_version) khi đổi/đặt lại mật khẩu
  const { data: user, error } = await supabase
    .from('users')
    .select('token_version')
    .eq('id', decoded.id)
    .single();

  if (error) {
    // Cột token_version chưa được thêm (migration chưa chạy) -> bỏ qua kiểm tra
    if (error.message?.includes('token_version')) {
      console.warn('protect: token_version column missing, skipping revocation check.');
    } else {
      res.status(401).json({ message: 'Not authorized, token failed' });
      return;
    }
  } else if (user) {
    const currentTv = Number(user.token_version ?? 1);
    // Token cũ (trước khi có claim tv) tương đương tv = 1
    const claimTv = decoded.tv === undefined ? 1 : Number(decoded.tv);
    if (!Number.isFinite(claimTv) || claimTv !== currentTv) {
      res.status(401).json({ message: 'Token revoked' });
      return;
    }
  } else {
    res.status(401).json({ message: 'Not authorized, token failed' });
    return;
  }

  req.user = { ...decoded, id: decoded.id };
  next();
};
