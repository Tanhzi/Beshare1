import { Response } from 'express';
import supabase from '../config/db';
import { AuthRequest } from '../middleware/authMiddleware';

export const updateProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  // Chỉ nhận full_name — avatar_url bắt buộc đổi qua POST /upload-avatar (Thấp 13)
  const { full_name } = req.body;
  const userId = req.user.id;

  try {
    const { data: updatedUser, error } = await supabase
      .from('users')
      .update({ full_name })
      .eq('id', userId)
      .select('id, email, full_name, avatar_url')
      .single();

    if (error) throw error;

    res.json({ 
      message: 'Profile updated successfully',
      user: updatedUser 
    });
  } catch (error: any) {
    console.error('Update Profile Error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
};
