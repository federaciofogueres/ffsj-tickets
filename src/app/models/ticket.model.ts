export interface ApiResponse<T> {
  ok: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface Ticket {
  codigo: string;
  activada: boolean;
  activadaAt: string | null;
  usada: boolean;
  usadaAt: string | null;
  bloqueada: boolean;
  fisica: boolean;
  createdAt: string;
  validatedAt: string | null;
  batchId: string | null;
  qrUrl: string | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  nextCursor: string | null;
}

export interface TicketBatchResult {
  batchId: string;
  totalGenerated: number;
  fisica: boolean;
  tickets: Array<{ codigo: string; qrUrl: string; fisica: boolean }>;
}

export interface TicketEmailResult {
  sent: number;
  email: string;
  batchId: string | null;
}

export interface TicketValidationResult {
  status: 'valid' | 'invalid' | 'inactive' | 'blocked' | 'used';
  codigo: string;
  message: string;
  ticket: Ticket | null;
}

export interface AdminStats {
  totalEntradas: number;
  totalActivadas: number;
  totalValidadas: number;
  totalBloqueadas: number;
  totalLotes: number;
}
