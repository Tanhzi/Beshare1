import rateLimit from 'express-rate-limit';

const message = (windowMinutes: number) => ({
  message: `Too many requests. Please try again in ${windowMinutes} minutes.`,
  code: 'RATE_LIMITED',
});

// Giới hạn đăng nhập: 10 lần / 15 phút / IP
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: message(15),
});

// Giới hạn OTP (quên/đặt lại mật khẩu): 5 lần / 15 phút / IP
export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: message(15),
});

// Giới hạn chia sẻ công khai (không đăng nhập): 10 lần / phút / IP
export const publicShareLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many public uploads. Please wait a moment and try again.',
    code: 'RATE_LIMITED',
  },
});
