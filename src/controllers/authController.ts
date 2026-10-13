import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomInt } from 'crypto';
import supabase from '../config/db'; // Import client mới
import { AuthRequest } from '../middleware/authMiddleware';
import { sendResetPasswordEmail } from '../services/emailService';

// --- Giới hạn số lần thử OTP (in-memory, theo email) ---
const MAX_OTP_ATTEMPTS = 5;
const OTP_WINDOW_MS = 10 * 60 * 1000; // 10 phút, khớp hạn của mã OTP
const otpAttempts = new Map<string, { count: number; expiresAt: number }>();
const getOtpKey = (email: unknown): string =>
  String(email || '').toLowerCase().trim();

// --- Lưu/xoá mã OTP: ưu tiên hash (bcrypt), fallback plaintext nếu migration chưa chạy (Thấp 11) ---
const storeResetCode = async (userId: string, code: string, expiresAt: string): Promise<void> => {
  const codeHash = await bcrypt.hash(code, 10);
  let { error } = await supabase
    .from('users')
    .update({ reset_code_hash: codeHash, reset_code: null, reset_code_expires: expiresAt })
    .eq('id', userId);

  if (error && String(error.message || '').includes('reset_code_hash')) {
    console.warn('storeResetCode: cột reset_code_hash chưa có — lưu plaintext (cần chạy migrations/000_init.sql).');
    ({ error } = await supabase
      .from('users')
      .update({ reset_code: code, reset_code_expires: expiresAt })
      .eq('id', userId));
  }

  if (error) throw error;
};

const invalidateResetCode = async (column: 'id' | 'email', value: string): Promise<void> => {
  const run = async (withHash: boolean) => {
    const payload: Record<string, unknown> = { reset_code: null, reset_code_expires: null };
    if (withHash) payload.reset_code_hash = null;
    return supabase.from('users').update(payload).eq(column, value);
  };

  let { error } = await run(true);
  if (error && String(error.message || '').includes('reset_code_hash')) {
    ({ error } = await run(false));
  }
  if (error) console.error('Invalidate reset code Error:', error.message);
};

// --- ĐĂNG KÝ ---
export const register = async (req: Request, res: Response): Promise<void> => {
  const { full_name } = req.body;
  const email = String(req.body.email).trim().toLowerCase();
  const { password } = req.body;

  try {
    // 1. Kiểm tra email đã tồn tại chưa
    const { data: existingUsers, error: checkError } = await supabase
      .from('users')
      .select('email')
      .eq('email', email);

    if (checkError) throw checkError;

    if (existingUsers && existingUsers.length > 0) {
      res.status(409).json({ message: 'Cannot register with this email' });
      return;
    }

    // 2. Mã hóa mật khẩu
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 3. Insert vào Supabase
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert([
        { 
          full_name, 
          email, 
          password_hash: passwordHash 
        }
      ])
      .select() // Để lấy lại dữ liệu vừa tạo
      .single();

    if (insertError) {
      // Race condition: 2 request song song cùng qua pre-check → unique constraint bắt (B3)
      if (insertError.code === '23505') {
        res.status(409).json({ message: 'Cannot register with this email' });
        return;
      }
      throw insertError;
    }

    // 4. Tạo Token (kèm token_version để có thể thu hồi khi đổi mật khẩu)
    const token = jwt.sign(
      { id: newUser.id, tv: Number(newUser.token_version ?? 1) },
      process.env.JWT_SECRET as string,
      { expiresIn: '7d' }
    );

    // Loại bỏ password_hash trước khi trả về
    const { password_hash: _ph, ...newUserInfo } = newUser;

    res.status(201).json({
      message: 'User registered successfully',
      user: newUserInfo,
      token
    });

  } catch (error: any) {
    console.error('Register Error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// --- ĐĂNG NHẬP ---
export const login = async (req: Request, res: Response): Promise<void> => {
  const email = String(req.body.email).trim().toLowerCase();
  const { password } = req.body;

  try {
    // 1. Tìm user theo email
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single(); // Lấy 1 bản ghi duy nhất

    if (error || !user) {
      res.status(400).json({ message: 'Invalid credentials' });
      return;
    }

    // 2. So sánh mật khẩu (Bcrypt)
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      res.status(400).json({ message: 'Invalid credentials' });
      return;
    }

    // 3. Tạo Token (kèm token_version để có thể thu hồi)
    const token = jwt.sign(
      { id: user.id, tv: Number(user.token_version ?? 1) },
      process.env.JWT_SECRET as string,
      { expiresIn: '7d' }
    );

    // Loại bỏ password_hash trước khi trả về
    const { password_hash, ...userInfo } = user;

    res.json({
      message: 'Login successful',
      user: userInfo,
      token
    });

  } catch (error: any) {
    console.error('Login Error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// --- ĐỔI MẬT KHẨU ---
export const changePassword = async (req: AuthRequest, res: Response): Promise<void> => {
  const { oldPassword, newPassword } = req.body;
  const userId = req.user.id; // Lấy ID từ token đã giải mã

  try {
    // 1. Lấy thông tin user hiện tại từ DB
    const { data: user, error } = await supabase
      .from('users')
      .select('password_hash, token_version')
      .eq('id', userId)
      .single();

    if (error || !user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    // 2. Kiểm tra mật khẩu cũ
    const isMatch = await bcrypt.compare(oldPassword, user.password_hash);
    if (!isMatch) {
      res.status(400).json({ message: 'Incorrect current password' });
      return;
    }

    // 3. Mã hóa mật khẩu mới
    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);

    // 4. Cập nhật vào DB + tăng token_version để thu hồi mọi token cũ
    const newTv = Number(user.token_version ?? 1) + 1;
    const { error: updateError } = await supabase
      .from('users')
      .update({ password_hash: newPasswordHash, token_version: newTv })
      .eq('id', userId);

    if (updateError) throw updateError;

    // 5. Cấp token mới để người dùng không bị đăng xuất
    const token = jwt.sign(
      { id: userId, tv: newTv },
      process.env.JWT_SECRET as string,
      { expiresIn: '7d' }
    );

    res.json({ message: 'Password updated successfully', token });

  } catch (error: any) {
    console.error('Change Password Error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// --- QUÊN MẬT KHẨU (Gửi OTP) ---
// Message chung cho mọi trường hợp → không leak email có/không tồn tại (B10)
const FORGOT_PASSWORD_GENERIC_MSG =
  'Nếu email đã đăng ký trong hệ thống, mã xác nhận đã được gửi đến email của bạn.';

export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  const email = String(req.body.email).trim().toLowerCase();

  try {
    // 1. Kiểm tra email tồn tại
    const { data: user, error } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (error || !user) {
      // Vẫn trả 200 với message chung để không phân biệt được email có tồn tại hay không (B10)
      res.json({ status: 'success', message: FORGOT_PASSWORD_GENERIC_MSG });
      return;
    }

    // 2. Tạo mã OTP (6 số ngẫu nhiên an toàn, không dùng Math.random)
    const resetCode = randomInt(100000, 1000000).toString();

    // 3. Thời gian hết hạn (10 phút)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // 4. Lưu hash mã OTP vào DB (email gửi đi vẫn là mã 6 số — Thấp 11)
    await storeResetCode(user.id, resetCode, expiresAt);

    // 5. Reset bộ đếm số lần thử khi cấp mã mới
    otpAttempts.delete(getOtpKey(email));

    // 5. Gửi Email (Gọi hàm mới dùng Axios)
    const emailSent = await sendResetPasswordEmail(email, resetCode);

    if (emailSent) {
      res.json({ status: 'success', message: FORGOT_PASSWORD_GENERIC_MSG });
    } else {
      res.status(500).json({ message: 'Lỗi khi gửi email. Vui lòng thử lại sau.' });
    }

  } catch (error: any) {
    console.error('Forgot Password Error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// --- ĐẶT LẠI MẬT KHẨU (Verify + Reset) ---
// Tương đương với việc gộp verifyOtp và resetPassword của PHP lại cho gọn
export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  const email = String(req.body.email).trim().toLowerCase();
  const { code, newPassword } = req.body; // code ở đây là otp

  try {
    const otpKey = getOtpKey(email);
    const nowMs = Date.now();

    // 0. Chặn brute force: đã thử quá 5 lần -> từ chối, yêu cầu mã mới
    const attempts = otpAttempts.get(otpKey);
    if (attempts && attempts.expiresAt > nowMs && attempts.count >= MAX_OTP_ATTEMPTS) {
      res.status(429).json({
        status: 'error',
        message: 'Quá nhiều lần thử mã xác nhận. Vui lòng yêu cầu mã mới.',
      });
      return;
    }

    // 1. Tìm user theo email, còn hạn OTP (đối chiếu bằng hash — Thấp 11)
    const now = new Date().toISOString();

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .gt('reset_code_expires', now) // Lớn hơn thời gian hiện tại
      .maybeSingle();

    let codeValid = false;
    if (user) {
      if (user.reset_code_hash) {
        try {
          codeValid = await bcrypt.compare(code, user.reset_code_hash);
        } catch {
          codeValid = false;
        }
      } else {
        // Fallback khi migration chưa chạy (code còn lưu plaintext)
        codeValid = typeof user.reset_code === 'string' && user.reset_code === code;
      }
    }

    if (error || !user || !codeValid) {
      // Tăng bộ đếm số lần sai
      const prev = otpAttempts.get(otpKey);
      const count =
        prev && prev.expiresAt > nowMs ? prev.count + 1 : 1;
      otpAttempts.set(otpKey, { count, expiresAt: nowMs + OTP_WINDOW_MS });

      // Quá 5 lần sai -> vô hiệu hoá mã OTP trong DB
      if (count >= MAX_OTP_ATTEMPTS && user) {
        await invalidateResetCode('id', user.id);
      }

      res.status(422).json({ 
        status: 'error', 
        message: 'Mã xác nhận không hợp lệ hoặc đã hết hạn.' 
      });
      return;
    }

    // 2. Mã hóa mật khẩu mới
    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);

    // 3. Cập nhật mật khẩu, xóa token và tăng token_version (thu hồi token cũ)
    const { error: updateError } = await supabase
      .from('users')
      .update({ 
        password_hash: newPasswordHash,
        token_version: Number(user.token_version ?? 1) + 1
      })
      .eq('id', user.id);

    if (updateError) throw updateError;

    // Xoá mã OTP đã dùng
    await invalidateResetCode('id', user.id);

    // 4. Reset bộ đếm sau khi đổi mật khẩu thành công
    otpAttempts.delete(otpKey);

    res.json({ status: 'success', message: 'Đổi mật khẩu thành công!' });

  } catch (error: any) {
    console.error('Reset Password Error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
};
