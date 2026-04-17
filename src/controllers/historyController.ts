import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import supabase from '../config/db';

// --- LẤY LỊCH SỬ GIAO DỊCH (GỬI & NHẬN) ---
export const getHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.id;

  try {
    // 1. Lấy danh sách file TÔI GỬI (Sent)
    const { data: sentDocs, error: sentError } = await supabase
      .from('documents')
      .select('*')
      .eq('owner_id', userId);

    if (sentError) throw sentError;

    // 2. Tìm Partner để lấy danh sách TÔI NHẬN (Received)
    // (Tìm trong bảng link_requests hoặc connections với trạng thái connected)
    const { data: connection } = await supabase
      .from('link_requests') // ⚠️ Đảm bảo tên bảng khớp với database của bạn
      .select('*')
      .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`)
      .eq('status', 'connected')
      .single();

    let receivedDocs: any[] = [];

    // Nếu có kết nối, lấy file của Partner
    if (connection) {
      const partnerId = connection.requester_id === userId 
        ? connection.receiver_id 
        : connection.requester_id;
      
      const { data: partnerDocs } = await supabase
        .from('documents')
        .select('*')
        .eq('owner_id', partnerId);
        
      if (partnerDocs) {
        receivedDocs = partnerDocs;
      }
    }

    // 3. Gộp và Map dữ liệu để Frontend dễ dùng
    const history = [
      ...sentDocs.map((d: any) => ({ ...d, history_type: 'sent' })),
      ...receivedDocs.map((d: any) => ({ ...d, history_type: 'received' }))
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()); // Mới nhất lên đầu

    res.json({ history });

  } catch (error: any) {
    console.error("History Error:", error.message);
    res.status(500).json({ message: 'Failed to fetch history' });
  }
};