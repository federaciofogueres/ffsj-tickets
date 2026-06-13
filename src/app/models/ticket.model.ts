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
  eventId: string | null;
  zoneId?: string | null;
  zoneName?: string | null;
  zoneColor?: string | null;
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

export interface PublicTicketView {
  codigo: string;
  eventName: string | null;
  eventDate: string | null;
  eventTime: string | null;
  zoneName: string | null;
  zoneColor: string | null;
  status: 'available' | 'inactive' | 'blocked' | 'used' | 'invalid';
  imageUrl: string | null;
  pdfUrl: string | null;
}

export interface TicketValidationResult {
  status: 'valid' | 'invalid' | 'inactive' | 'blocked' | 'used' | 'wrong_zone';
  codigo: string;
  message: string;
  ticket: Ticket | null;
  summary?: {
    type: 'ticket' | 'batch';
    total: number;
    validatedNow: number;
    alreadyValidated: number;
    inactive: number;
    blocked: number;
    validatedAt: string | null;
  };
}

export interface OfflineManifest {
  eventId: string | null;
  year: string;
  generatedAt: string;
  checksum: string;
  tickets: Ticket[];
  zones: TicketAccessZone[];
}

export interface OfflineSyncValidation {
  clientValidationId: string;
  code: string;
  zoneId?: string | null;
  validatedAt?: string | null;
}

export interface OfflineSyncItemResult {
  clientValidationId: string;
  code: string;
  status: 'synced' | 'conflict' | 'failed';
  validation: TicketValidationResult;
}

export interface OfflineSyncResult {
  deviceId: string | null;
  attempted: number;
  synced: number;
  conflicts: number;
  failed: number;
  results: OfflineSyncItemResult[];
}

export interface AdminStats {
  totalEntradas: number;
  totalActivadas: number;
  totalValidadas: number;
  totalBloqueadas: number;
  totalLotes: number;
}

export interface TicketEvent {
  id: string;
  year: string;
  nombre: string;
  descripcion: string | null;
  fechaEvento: string | null;
  horaEvento: string | null;
  estado: 'activo' | 'finalizado' | 'inactivo';
  createdAt: string;
  updatedAt: string;
}

export interface TicketAccessZone {
  id: string;
  eventId: string;
  nombre: string;
  colorHex: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TicketZoneSummary {
  zoneId: string | null;
  zoneName: string;
  total: number;
  active: number;
  available: number;
  validated: number;
  blocked: number;
}

export interface TrackingLog {
  id: number;
  year: string;
  action: string;
  actorId: string | null;
  actorLabel: string | null;
  ip: string | null;
  method: string;
  path: string;
  targetType: string | null;
  targetId: string | null;
  status: string;
  message: string | null;
  metadata: unknown;
  createdAt: string;
}
