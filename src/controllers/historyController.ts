import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import supabase from '../config/db';

const getPartnerId = async (userId: string): Promise<string | null> => {
  const { data: connection } = await supabase
    .from('connections')
    .select('requester_id, receiver_id')
    .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`)
    .eq('status', 'connected')
    .maybeSingle();

  if (!connection) return null;
  return connection.requester_id === userId
    ? connection.receiver_id
    : connection.requester_id;
};

export const getHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user.id;
  const pairOnly = req.query.pairOnly === 'true';

  try {
    let sent: any[] = [];
    let received: any[] = [];

    if (pairOnly) {
      // --- PAIR-ONLY MODE: only docs shared between linked accounts ---
      const partnerId = await getPartnerId(userId);
      if (!partnerId) {
        res.json({ history: [] });
        return;
      }

      // Sent: docs I own that have transfer_history to partner
      const { data: sentRecords } = await supabase
        .from('transfer_history')
        .select('document_id, created_at, documents:document_id(*)')
        .eq('sender_id', userId)
        .eq('receiver_id', partnerId)
        .in('action_type', ['share', 'download', 'private_share'])
        .order('created_at', { ascending: false });

      sent = (sentRecords || []).map((r: any) => {
        const doc = Array.isArray(r.documents) ? r.documents[0] : r.documents;
        return {
          id: r.document_id,
          name: doc?.name || 'Unknown',
          file_type: doc?.file_type || '',
          file_size: doc?.file_size || 0,
          file_url: doc?.file_url || '',
          is_protected: doc?.is_protected || false,
          created_at: r.created_at,
          history_type: 'sent',
        };
      });

      // Received: transfer_history from partner to me
      const { data: receivedRecords } = await supabase
        .from('transfer_history')
        .select('document_id, created_at, documents:document_id(*)')
        .eq('sender_id', partnerId)
        .eq('receiver_id', userId)
        .in('action_type', ['share', 'download', 'private_share'])
        .order('created_at', { ascending: false });

      const seenIds = new Set<string>();
      received = (receivedRecords || [])
        .filter((r: any) => {
          if (seenIds.has(r.document_id)) return false;
          seenIds.add(r.document_id);
          return true;
        })
        .map((r: any) => {
          const doc = Array.isArray(r.documents) ? r.documents[0] : r.documents;
          return {
            id: r.document_id,
            name: doc?.name || 'Unknown',
            file_type: doc?.file_type || '',
            file_size: doc?.file_size || 0,
            file_url: doc?.file_url || '',
            is_protected: doc?.is_protected || false,
            created_at: r.created_at,
            history_type: 'received',
          };
        });
    } else {
      // --- NORMAL MODE: all my docs + all received ---
      const { data: sentDocs, error: sentError } = await supabase
        .from('documents')
        .select('*')
        .eq('owner_id', userId);

      if (sentError) throw sentError;

      const { data: receivedRecords, error: recvError } = await supabase
        .from('transfer_history')
        .select('document_id, created_at, action_type, documents:document_id(*)')
        .eq('receiver_id', userId)
        .order('created_at', { ascending: false });

      if (recvError) throw recvError;

      sent = (sentDocs || []).map((d: any) => ({
        id: d.id,
        name: d.name,
        file_type: d.file_type,
        file_size: d.file_size,
        file_url: d.file_url,
        is_protected: d.is_protected,
        created_at: d.created_at,
        history_type: 'sent',
      }));

      const seenIds = new Set<string>();
      received = (receivedRecords || [])
        .filter((r: any) => {
          if (seenIds.has(r.document_id)) return false;
          seenIds.add(r.document_id);
          return true;
        })
        .map((r: any) => {
          const doc = Array.isArray(r.documents) ? r.documents[0] : r.documents;
          return {
            id: r.document_id,
            name: doc?.name || 'Unknown',
            file_type: doc?.file_type || '',
            file_size: doc?.file_size || 0,
            file_url: doc?.file_url || '',
            is_protected: doc?.is_protected || false,
            created_at: r.created_at,
            history_type: 'received',
          };
        });
    }

    const history = [...sent, ...received].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    res.json({ history });
  } catch (error: any) {
    console.error('History Error:', error.message);
    res.status(500).json({ message: 'Failed to fetch history' });
  }
};
