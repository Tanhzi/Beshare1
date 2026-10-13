// src/validation/schemas.ts — Zod schemas tập trung cho validate input (B1)
import { z } from 'zod';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIX_DIGIT_RE = /^\d{6}$/;

// --- Trường dùng lại ---
export const emailField = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long')
  .refine((v) => EMAIL_RE.test(v), 'Invalid email address');

export const newPasswordField = z
  .string({ error: 'Password is required' })
  .min(6, 'Password must be at least 6 characters')
  .max(128, 'Password must be at most 128 characters');

// Đăng nhập: chỉ yêu cầu có mặt (mật khẩu cũ có thể ngắn hơn 8 ký tự)
const existingPasswordField = z
  .string({ error: 'Password is required' })
  .min(1, 'Password is required')
  .max(128, 'Password must be at most 128 characters');

const uuidField = z
  .string({ error: 'Id is required' })
  .trim()
  .refine((v) => UUID_RE.test(v), 'Invalid id format');

// Số thực trong khoảng (nhận number hoặc string từ multipart/query)
const numberInRange = (min: number, max: number, label: string) =>
  z
    .union([z.number(), z.string()], { error: `${label} is required` })
    .refine((v) => String(v).trim() !== '', `${label} is required`)
    .transform((v) => (typeof v === 'number' ? v : Number(String(v).trim())))
    .refine((n) => Number.isFinite(n), `Invalid ${label}`)
    .refine((n) => n >= min && n <= max, `${label} must be between ${min} and ${max}`);

// Boolean tường minh: true/false hoặc 'true'/'false'
const boolish = z
  .union([z.boolean(), z.enum(['true', 'false'])], { error: 'Must be a boolean' })
  .transform((v) => v === true || v === 'true');

const optionalBoolish = boolish.optional();

// --- Auth ---
export const registerSchema = z.object({
  full_name: z
    .string({ error: 'Full name is required' })
    .trim()
    .min(1, 'Full name is required')
    .max(100, 'Full name is too long'),
  email: emailField,
  password: newPasswordField,
});

export const loginSchema = z.object({
  email: emailField,
  password: existingPasswordField,
});

export const forgotPasswordSchema = z.object({
  email: emailField,
});

export const resetPasswordSchema = z.object({
  email: emailField,
  code: z
    .string({ error: 'Code is required' })
    .trim()
    .refine((v) => SIX_DIGIT_RE.test(v), 'Code must be a 6-digit number'),
  newPassword: newPasswordField,
});

export const changePasswordSchema = z.object({
  oldPassword: z
    .string({ error: 'Old password is required' })
    .min(1, 'Old password is required')
    .max(128, 'Password must be at most 128 characters'),
  newPassword: newPasswordField,
});

export const updateProfileSchema = z.object({
  full_name: z
    .string({ error: 'Full name is required' })
    .trim()
    .min(1, 'Full name is required')
    .max(100, 'Full name is too long'),
});

// --- Documents ---
const EXPIRATION_OPTIONS = ['1 hour', '6 hours', '1 day', '3 days', '7 days', 'none', 'never'] as const;

const shareBodyBase = {
  category: z.enum(['Photos', 'Videos', 'Files', 'Links', 'Text'], { error: 'Invalid category' }),
  linkContent: z.string().trim().max(4096, 'Link is too long').optional(),
  textContent: z.string().max(200000, 'Text content is too long').optional(),
  expiration: z.enum(EXPIRATION_OPTIONS, { error: `expiration must be one of: ${EXPIRATION_OPTIONS.join(', ')}` }),
  password: z.string().max(128, 'Password must be at most 128 characters').optional(),
  isAnonymous: optionalBoolish,
  latitude: numberInRange(-90, 90, 'latitude'),
  longitude: numberInRange(-180, 180, 'longitude'),
};

export const shareSchema = z.object({
  ...shareBodyBase,
  isPublicSharing: optionalBoolish,
});

export const sharePublicSchema = z.object(shareBodyBase);

export const scanQuerySchema = z.object({
  latitude: numberInRange(-90, 90, 'latitude'),
  longitude: numberInRange(-180, 180, 'longitude'),
  radius: numberInRange(1, 50000, 'radius').optional(),
});

export const verifyPasswordSchema = z.object({
  documentId: uuidField,
  password: z.string().max(128, 'Password must be at most 128 characters').optional(),
});

export const updatePasswordProtectionSchema = z.object({
  isProtected: boolish,
  password: z.string().max(128, 'Password must be at most 128 characters').optional(),
});

// --- Sync ---
export const linkSchema = z.object({
  email: emailField,
});

export const respondSchema = z.object({
  connectionId: uuidField,
  action: z.enum(['accept', 'reject'], { error: "action must be 'accept' or 'reject'" }),
});

export const settingsSchema = z.object({
  autoDownload: boolish,
  autoView: boolish,
});

export const cancelSchema = z.object({
  connectionId: uuidField,
});
