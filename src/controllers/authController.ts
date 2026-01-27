import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import supabase from '../config/db'; // Import client mới
import { AuthRequest } from '../middleware/authMiddleware';
import { sendResetPasswordEmail } from '../services/emailService';

// --- ĐĂNG KÝ ---
export const register = async (req: Request, res: Response): Promise<void> => {
  const { full_name, email, password } = req.body;

  try {
    // 1. Kiểm tra email đã tồn tại chưa
    const { data: existingUsers, error: checkError } = await supabase
      .from('users')
      .select('email')
      .eq('email', email);

    if (checkError) throw checkError;

    if (existingUsers && existingUsers.length > 0) {
      res.status(400).json({ message: 'Email already exists' });
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

    if (insertError) throw insertError;

    // 4. Tạo Token
    const token = jwt.sign({ id: newUser.id }, process.env.JWT_SECRET as string, { expiresIn: '7d' });

    res.status(201).json({
      message: 'User registered successfully',
      user: newUser,
      token
    });

  } catch (error: any) {
    console.error('Register Error:', error.message);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// --- ĐĂNG NHẬP ---
export const login = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;

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

    // 3. Tạo Token
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET as string, { expiresIn: '7d' });

    // Loại bỏ password_hash trước khi trả về
    const { password_hash, ...userInfo } = user;

    res.json({
      message: 'Login successful',
      user: userInfo,
      token
    });

  } catch (error: any) {
    console.error('Login Error:', error.message);
    res.status(500).json({ message: 'Server error', error: error.message });
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
      .select('password_hash')
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

    // 4. Cập nhật vào DB
    const { error: updateError } = await supabase
      .from('users')
      .update({ password_hash: newPasswordHash })
      .eq('id', userId);

    if (updateError) throw updateError;

    res.json({ message: 'Password updated successfully' });

  } catch (error: any) {
    console.error('Change Password Error:', error.message);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// --- QUÊN MẬT KHẨU (Gửi OTP) ---
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body;

  try {
    // 1. Kiểm tra email tồn tại
    const { data: user, error } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (error || !user) {
      // Báo lỗi 404 giống PHP để frontend dễ xử lý
      res.status(404).json({ message: 'Email này chưa được đăng ký.' });
      return;
    }

    // 2. Tạo mã OTP (6 số ngẫu nhiên) giống PHP: rand(100000, 999999)
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // 3. Thời gian hết hạn (10 phút)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // 4. Lưu vào DB
    const { error: updateError } = await supabase
      .from('users')
      .update({ 
        reset_code: resetCode, 
        reset_code_expires: expiresAt 
      })
      .eq('id', user.id);

    if (updateError) throw updateError;

    // 5. Gửi Email (Gọi hàm mới dùng Axios)
    const emailSent = await sendResetPasswordEmail(email, resetCode);

    if (emailSent) {
      res.json({ status: 'success', message: 'Mã xác nhận đã được gửi đến email của bạn.' });
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
  const { email, code, newPassword } = req.body; // code ở đây là otp

  try {
    // 1. Tìm user khớp email, code và thời gian chưa hết hạn
    // PHP: ->where('reset_expires_at', '>', now())
    const now = new Date().toISOString();

    const { data: user, error } = await supabase
      .from('users')
      .select('id, reset_code_expires')
      .eq('email', email)
      .eq('reset_code', code)
      .gt('reset_code_expires', now) // Lớn hơn thời gian hiện tại
      .single();

    if (error || !user) {
      res.status(422).json({ 
        status: 'error', 
        message: 'Mã xác nhận không hợp lệ hoặc đã hết hạn.' 
      });
      return;
    }

    // 2. Mã hóa mật khẩu mới
    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);

    // 3. Cập nhật mật khẩu và xóa token
    const { error: updateError } = await supabase
      .from('users')
      .update({ 
        password_hash: newPasswordHash,
        reset_code: null,
        reset_code_expires: null 
      })
      .eq('id', user.id);

    if (updateError) throw updateError;

    res.json({ status: 'success', message: 'Đổi mật khẩu thành công!' });

  } catch (error: any) {
    console.error('Reset Password Error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
};
