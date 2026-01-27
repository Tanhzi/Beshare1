import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

export const sendResetPasswordEmail = async (toEmail: string, resetCode: string) => {
  const url = 'https://api.brevo.com/v3/smtp/email';
  
  // Kiểm tra cấu hình
  if (!process.env.BREVO_API_KEY || !process.env.SENDER_EMAIL) {
    console.error('❌ Missing Brevo Config');
    return false;
  }

  const data = {
    sender: {
      name: process.env.SENDER_NAME || 'AI Study Buddy',
      email: process.env.SENDER_EMAIL, // Email này PHẢI được verify trong Brevo
    },
    to: [
      {
        email: toEmail,
      },
    ],
    subject: "Mã đặt lại mật khẩu - AI Study Buddy",
    htmlContent: `
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
            <h2 style="color: #2563EB; text-align: center;">Yêu cầu đặt lại mật khẩu</h2>
            <p>Xin chào,</p>
            <p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.</p>
            <p>Mã xác nhận của bạn là:</p>
            <div style="text-align: center; margin: 30px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #2563EB; background-color: #f0fdf4; padding: 10px 20px; border-radius: 8px;">
                ${resetCode}
              </span>
            </div>
            <p>Mã này sẽ hết hạn trong <strong>10 phút</strong>.</p>
            <p style="font-size: 12px; color: #888;">Nếu bạn không yêu cầu điều này, vui lòng bỏ qua email.</p>
          </div>
        </body>
      </html>
    `,
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        'accept': 'application/json',
        'api-key': process.env.BREVO_API_KEY, // Header quan trọng giống PHP
        'content-type': 'application/json',
      },
    });

    if (response.status === 201 || response.status === 200) {
      console.log(`✅ Email sent successfully to ${toEmail}`);
      return true;
    } else {
      console.error('⚠️ Brevo returned unexpected status:', response.status);
      return false;
    }
  } catch (error: any) {
    // Log chi tiết lỗi để debug
    console.error('❌ Failed to send email:', error.response?.data || error.message);
    return false;
  }
};