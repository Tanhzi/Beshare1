import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import supabase from '../config/db';

const getUserPreferences = async (userId: string): Promise<{ autoDownload: boolean; autoView: boolean }> => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('auto_download, auto_view')
      .eq('id', userId)
      .single();
    if (error || !data) return { autoDownload: false, autoView: false };
    return {
      autoDownload: data.auto_download === true,
      autoView: data.auto_view === true,
    };
  } catch {
    return { autoDownload: false, autoView: false };
  }
};

const saveUserPreferences = async (
  userId: string,
  prefs: { autoDownload: boolean; autoView: boolean }
): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('users')
      .update({
        auto_download: prefs.autoDownload,
        auto_view: prefs.autoView,
      })
      .eq('id', userId);
    if (error) console.error('[saveUserPreferences] error:', error);
    return !error;
  } catch (err) {
    console.error('[saveUserPreferences] exception:', err);
    return false;
  }
};

// Hàm kiểm tra loại file dựa trên extension
const getFileTypeFromExtension = (fileName: string): string => {
  const ext = fileName.toLowerCase().split('.').pop();
  
  // Image extensions
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff'];
  // Video extensions
  const videoExts = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv', '3gp', 'm4v'];
  // Document extensions
  const documentExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf'];
  // Audio extensions
  const audioExts = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a'];
  // Archive extensions
  const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz'];
  
  if (imageExts.includes(ext || '')) return 'image';
  if (videoExts.includes(ext || '')) return 'video';
  if (audioExts.includes(ext || '')) return 'audio';
  if (documentExts.includes(ext || '')) return 'document';
  if (archiveExts.includes(ext || '')) return 'archive';
  
  return 'file'; // Default for unknown types
};

// --- 1. GỬI LỜI MỜI LIÊN KẾT ---
export const linkAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  const { email } = req.body;
  const myId = req.user.id;

  try {
    // Tìm người dùng theo email
    const { data: partner, error: findError } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', email)
      .single();

    if (findError || !partner) {
      res.status(404).json({ message: 'Unable to find a user with that email' });
      return;
    }

    if (partner.id === myId) {
      res.status(400).json({ message: 'Cannot link with yourself' });
      return;
    }

    // Kiểm tra kết nối đã tồn tại chưa — không bỏ qua lỗi query (B3)
    const { data: existing, error: existError } = await supabase
      .from('connections')
      .select('*')
      .or(`and(requester_id.eq.${myId},receiver_id.eq.${partner.id}),and(requester_id.eq.${partner.id},receiver_id.eq.${myId})`)
      .maybeSingle();

    if (existError) throw existError;

    if (existing) {
      if (existing.status === 'connected') {
        res.status(400).json({ message: 'Already linked with this user' });
      } else {
        res.status(400).json({ message: 'Request is already pending' });
      }
      return;
    }

    // Giới hạn số lời mời đang chờ (chống spam) — Thấp 14
    const { count: pendingCount, error: countError } = await supabase
      .from('connections')
      .select('id', { count: 'exact', head: true })
      .eq('requester_id', myId)
      .eq('status', 'pending');

    if (countError) throw countError;

    if ((pendingCount ?? 0) >= 10) {
      res.status(429).json({
        message: 'Too many pending invitations. Cancel some before sending more.',
      });
      return;
    }

    // Tạo lời mời
    const { error: createError } = await supabase
      .from('connections')
      .insert([{ 
        requester_id: myId, 
        receiver_id: partner.id,
        status: 'pending',
      }]);

    if (createError) {
      // Race condition: 2 request song song cùng qua check → unique index bắt (B3)
      if (createError.code === '23505') {
        res.status(409).json({ message: 'Request is already pending' });
        return;
      }
      throw createError;
    }

    res.json({ message: 'Invitation sent! Waiting for approval.' });

  } catch (error: any) {
    console.error('Link Error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// --- 2. LẤY DANH SÁCH YÊU CẦU (INCOMING / OUTGOING) ---
export const getPendingRequests = async (req: AuthRequest, res: Response): Promise<void> => {
  const myId = req.user.id;

  try {
    // Lời mời gửi ĐẾN mình (Mình là receiver)
    const { data: incoming, error: incomingError } = await supabase
      .from('connections')
      .select(`
        id, created_at,
        requester:requester_id (id, full_name, email, avatar_url)
      `)
      .eq('receiver_id', myId)
      .eq('status', 'pending');

    if (incomingError) throw incomingError;

    // Lời mời mình GỬI ĐI (Mình là requester)
    const { data: outgoing, error: outgoingError } = await supabase
      .from('connections')
      .select(`
        id, created_at,
        receiver:receiver_id (id, full_name, email, avatar_url)
      `)
      .eq('requester_id', myId)
      .eq('status', 'pending');

    if (outgoingError) throw outgoingError;

    res.json({ 
      incoming: incoming || [],
      outgoing: outgoing || []
    });

  } catch (error: any) {
    res.status(500).json({ message: 'Server error' });
  }
};

// --- 3. PHẢN HỒI YÊU CẦU (ACCEPT / REJECT) ---
export const respondToRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  const myId = req.user.id;
  const { connectionId, action } = req.body; // action: 'accept' | 'reject'

  try {
    // Kiểm tra request có tồn tại và mình là người nhận không
    const { data: request } = await supabase
      .from('connections')
      .select('id')
      .eq('id', connectionId)
      .eq('receiver_id', myId) // Bảo mật: Chỉ người nhận mới được xử lý
      .eq('status', 'pending')
      .single();

    if (!request) {
      res.status(404).json({ message: 'Request not found or invalid' });
      return;
    }

    if (action === 'accept') {
      const { error } = await supabase
        .from('connections')
        .update({ status: 'connected' })
        .eq('id', connectionId);
        
      if (error) throw error;
      res.json({ message: 'Account linked successfully!' });

    } else {
      const { error } = await supabase
        .from('connections')
        .delete()
        .eq('id', connectionId);

      if (error) throw error;
      res.json({ message: 'Request rejected' });
    }

  } catch (error: any) {
    res.status(500).json({ message: 'Server error' });
  }
};

// --- 4. LẤY TRẠNG THÁI LIÊN KẾT (STATUS) ---
export const getSyncStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  const myId = req.user.id;

  try {
    const { data: connection, error } = await supabase
      .from('connections')
      .select(`
        *,
        requester:requester_id (id, full_name, email, avatar_url),
        receiver:receiver_id (id, full_name, email, avatar_url)
      `)
      .or(`requester_id.eq.${myId},receiver_id.eq.${myId}`)
      .eq('status', 'connected') // Chỉ lấy cái đã kết nối
      .maybeSingle();

    if (error || !connection) {
      res.json({ isLinked: false });
      return;
    }

    const isRequester = connection.requester_id === myId;
    const partner = isRequester ? connection.receiver : connection.requester;

    // Preferences riêng từng user (lưu trong users table)
    const prefs = await getUserPreferences(myId);
    const autoDownload = prefs.autoDownload;
    const autoView = prefs.autoView;

    res.json({
      isLinked: true,
      connectionId: connection.id,
      autoDownload,
      autoView,
      partner: {
        name: partner.full_name || partner.email,
        email: partner.email,
        avatar: partner.avatar_url,
        status: 'Connected'
      }
    });

  } catch (error: any) {
    res.status(500).json({ message: 'Server error' });
  }
};

// --- 5. UNLINK ---
export const unlinkAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  const myId = req.user.id;
  try {
    // Tìm kết nối trước khi xoá để dọn các bản ghi private_share (Thấp 12)
    const { data: connection, error: connError } = await supabase
      .from('connections')
      .select('requester_id, receiver_id')
      .or(`requester_id.eq.${myId},receiver_id.eq.${myId}`)
      .eq('status', 'connected')
      .maybeSingle();

    if (connError) throw connError;

    if (connection) {
      const partnerId = connection.requester_id === myId
        ? connection.receiver_id
        : connection.requester_id;

      const { error: historyError } = await supabase
        .from('transfer_history')
        .delete()
        .eq('action_type', 'private_share')
        .or(
          `and(sender_id.eq.${myId},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${myId})`
        );

      if (historyError) throw historyError;
    }

    const { error } = await supabase
      .from('connections')
      .delete()
      .or(`requester_id.eq.${myId},receiver_id.eq.${myId}`)
      .eq('status', 'connected');

    if (error) throw error;
    res.json({ message: 'Unlinked successfully' });

  } catch (error: any) {
    res.status(500).json({ message: 'Server error' });
  }
};

// --- 6. UPDATE SETTINGS (per-user) ---
export const updateSettings = async (req: AuthRequest, res: Response): Promise<void> => {
  const myId = req.user.id;
  const { autoDownload, autoView } = req.body;

  try {
    const ok = await saveUserPreferences(myId, { autoDownload, autoView });
    if (!ok) throw new Error('Failed to save preferences');

    res.json({ message: 'Settings updated' });

  } catch (error: any) {
    console.error('[updateSettings] error:', error?.message || error);
    res.status(500).json({ message: 'Failed to update settings' });
  }
};

// --- 7. HỦY LỜI MỜI (Dành cho người gửi muốn rút lại) ---
export const cancelRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  const myId = req.user.id;
  const { connectionId } = req.body;

  try {
    // Chỉ xóa được nếu mình là người GỬI (requester) và status là 'pending'
    const { data: deleted, error } = await supabase
      .from('connections')
      .delete()
      .eq('id', connectionId)
      .eq('requester_id', myId)
      .eq('status', 'pending')
      .select('id');

    if (error) throw error;

    // Không xoá được dòng nào -> 404 (Thấp 15)
    if (!deleted || deleted.length === 0) {
      res.status(404).json({ message: 'Request not found' });
      return;
    }

    res.json({ message: 'Request cancelled successfully' });

  } catch (error: any) {
    res.status(500).json({ message: 'Server error' });
  }
};

// --- 8. LẤY TÀI LIỆU MỚI NHẤT CỦA PARTNER (INSTANT PREVIEW) ---
export const getPartnerDocuments = async (req: AuthRequest, res: Response): Promise<void> => {
  const myId = req.user.id;

  try {
    // 1. Lấy thông tin kết nối hiện tại
    const { data: connection, error: connError } = await supabase
      .from('connections')
      .select('requester_id, receiver_id')
      .or(`requester_id.eq.${myId},receiver_id.eq.${myId}`)
      .eq('status', 'connected')
      .maybeSingle();

    if (connError || !connection) {
      res.status(404).json({ message: 'No active connection found' });
      return;
    }

    // 2. Xác định ID của partner
    const partnerId = connection.requester_id === myId ? connection.receiver_id : connection.requester_id;

    // 3. Lấy tài liệu mới nhất của partner (giới hạn 10 item, sắp xếp theo thời gian)
    const { data: partnerOwnedDocs, error: docError } = await supabase
      .from('documents')
      .select(`
        id,
        name,
        file_type,
        file_url,
        file_size,
        created_at,
        is_protected,
        expires_at
      `)
      .eq('owner_id', partnerId)
      .eq('status', 'active')
      .or('expires_at.is.null,expires_at.gt.now()')
      .order('created_at', { ascending: false })
      .limit(10);

    if (docError) throw docError;

    // 4. Lấy thêm tài liệu partner đã private_share cho tôi
    const { data: privateShareRecords } = await supabase
      .from('transfer_history')
      .select('document_id')
      .eq('sender_id', partnerId)
      .eq('receiver_id', myId)
      .eq('action_type', 'private_share');

    let privateSharedDocs: any[] = [];
    if (privateShareRecords && privateShareRecords.length > 0) {
      const docIds = privateShareRecords.map((r: any) => r.document_id);
      const { data: docs } = await supabase
        .from('documents')
        .select(`
          id, name, file_type, file_url, file_size, created_at,
          is_protected, expires_at
        `)
        .in('id', docIds)
        .or('expires_at.is.null,expires_at.gt.now()');

      if (docs) privateSharedDocs = docs;
    }

    // 5. Gộp và xử lý
    const allDocs = [...(partnerOwnedDocs || []), ...privateSharedDocs]
      .filter((doc, i, arr) => arr.findIndex(d => d.id === doc.id) === i) // dedupe
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 10);

    // 6. Xử lý và bổ sung thông tin cho từng tài liệu
    const processedDocs = allDocs.map(doc => {
      let previewType = 'file';
      let previewContent = null;

      // Ưu tiên kiểm tra extension thực tế trước
      if (doc.file_type === 'Files') {
        previewType = getFileTypeFromExtension(doc.name);
      } else {
        // Xác định loại preview theo file_type từ database
        switch (doc.file_type) {
          case 'Photos':
            previewType = 'image';
            break;
          case 'Videos':
            previewType = 'video';
            break;
          case 'Links':
            previewType = 'link';
            previewContent = doc.file_url; // URL gốc
            break;
          case 'Text':
            previewType = 'text';
            break;
          default:
            // Fallback: kiểm tra extension nếu file_type không rõ ràng
            previewType = getFileTypeFromExtension(doc.name);
        }
      }

      return {
        id: doc.id,
        name: doc.name,
        type: previewType,
        content: previewContent,
        fileSize: doc.file_size,
        createdAt: doc.created_at,
        isProtected: doc.is_protected,
        expiresAt: doc.expires_at
      };
    });

    res.json({ 
      documents: processedDocs,
      hasDocuments: processedDocs.length > 0
    });

  } catch (error: any) {
    console.error('Get Partner Documents Error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
};