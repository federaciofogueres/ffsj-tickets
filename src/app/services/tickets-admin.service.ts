import { HttpClient, HttpEvent, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { AdminStats, ApiResponse, BackofficeAdminContext, BackofficeAssociationModulePermissions, BackofficeModuleKey, OfflineManifest, OfflineSyncResult, OfflineSyncValidation, PaginatedResponse, Ticket, TicketAccessZone, TicketBatchResult, TicketEmailResult, TicketEvent, TicketValidationResult, TicketZoneSummary, TrackingLog } from '../models/ticket.model';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class TicketsAdminService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly baseUrl = environment.adminApiBaseUrl;

  private get headers(): HttpHeaders {
    let headers = new HttpHeaders();
    const token = this.authService.getToken();
    if (token) {
      headers = headers.set('Authorization', `Bearer ${token}`);
    }
    if (environment.adminApiKey) {
      headers = headers.set('x-admin-key', environment.adminApiKey);
    }
    return headers;
  }

  private params(year: string, extra: Record<string, string | number | boolean | null | undefined> = {}): HttpParams {
    let params = new HttpParams().set('year', year);
    Object.entries(extra).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') {
        params = params.set(key, String(value));
      }
    });
    return params;
  }

  me(): Observable<ApiResponse<BackofficeAdminContext>> {
    return this.http.get<ApiResponse<BackofficeAdminContext>>(`${this.baseUrl}/me`, { headers: this.headers });
  }

  listModulePermissions(): Observable<ApiResponse<{ modules: BackofficeAdminContext['allModules']; permissions: BackofficeAssociationModulePermissions[] }>> {
    return this.http.get<ApiResponse<{ modules: BackofficeAdminContext['allModules']; permissions: BackofficeAssociationModulePermissions[] }>>(`${this.baseUrl}/module-permissions`, { headers: this.headers });
  }

  updateModulePermissions(cargoId: string, modules: BackofficeModuleKey[]): Observable<ApiResponse<BackofficeAssociationModulePermissions>> {
    return this.http.put<ApiResponse<BackofficeAssociationModulePermissions>>(`${this.baseUrl}/module-permissions`, { cargoId, idCargo: cargoId, modules }, { headers: this.headers });
  }

  stats(year: string): Observable<ApiResponse<AdminStats>> {
    return this.http.get<ApiResponse<AdminStats>>(`${this.baseUrl}/stats`, { headers: this.headers, params: this.params(year) });
  }

  listEvents(year: string): Observable<ApiResponse<TicketEvent[]>> {
    return this.http.get<ApiResponse<TicketEvent[]>>(`${this.baseUrl}/eventos`, { headers: this.headers, params: this.params(year) });
  }

  createEvent(payload: { nombre: string; descripcion?: string | null; fechaEvento?: string | null; horaEvento?: string | null; estado?: 'activo' | 'finalizado' | 'inactivo' }, year: string): Observable<ApiResponse<TicketEvent>> {
    return this.http.post<ApiResponse<TicketEvent>>(`${this.baseUrl}/eventos`, payload, { headers: this.headers, params: this.params(year) });
  }

  updateEvent(eventId: string, payload: { nombre?: string; descripcion?: string | null; fechaEvento?: string | null; horaEvento?: string | null; estado?: 'activo' | 'finalizado' | 'inactivo' }, year: string): Observable<ApiResponse<TicketEvent>> {
    return this.http.put<ApiResponse<TicketEvent>>(`${this.baseUrl}/eventos/${encodeURIComponent(eventId)}`, payload, { headers: this.headers, params: this.params(year) });
  }

  listZones(year: string, eventId: string): Observable<ApiResponse<TicketAccessZone[]>> {
    return this.http.get<ApiResponse<TicketAccessZone[]>>(`${this.baseUrl}/eventos/${encodeURIComponent(eventId)}/zonas`, { headers: this.headers, params: this.params(year) });
  }

  statsByZone(year: string, eventId: string): Observable<ApiResponse<TicketZoneSummary[]>> {
    return this.http.get<ApiResponse<TicketZoneSummary[]>>(`${this.baseUrl}/eventos/${encodeURIComponent(eventId)}/zonas/stats`, { headers: this.headers, params: this.params(year) });
  }

  createZone(year: string, eventId: string, payload: { nombre: string; colorHex: string }): Observable<ApiResponse<TicketAccessZone>> {
    return this.http.post<ApiResponse<TicketAccessZone>>(`${this.baseUrl}/eventos/${encodeURIComponent(eventId)}/zonas`, payload, { headers: this.headers, params: this.params(year) });
  }

  updateZone(year: string, eventId: string, zoneId: string, payload: { nombre: string; colorHex: string }): Observable<ApiResponse<TicketAccessZone>> {
    return this.http.put<ApiResponse<TicketAccessZone>>(`${this.baseUrl}/eventos/${encodeURIComponent(eventId)}/zonas/${encodeURIComponent(zoneId)}`, payload, { headers: this.headers, params: this.params(year) });
  }

  deleteZone(year: string, eventId: string, zoneId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/eventos/${encodeURIComponent(eventId)}/zonas/${encodeURIComponent(zoneId)}`, { headers: this.headers, params: this.params(year) });
  }

  statsForEvent(year: string, eventId: string | null): Observable<ApiResponse<AdminStats>> {
    return this.http.get<ApiResponse<AdminStats>>(`${this.baseUrl}/stats`, { headers: this.headers, params: this.params(year, { eventId }) });
  }

  listTickets(options: { year: string; eventId?: string | null; limit: number; cursor?: string | null; status?: string; search?: string; mode?: 'single' | 'batch'; visibility?: 'visible' | 'hidden' | 'all' }): Observable<ApiResponse<PaginatedResponse<Ticket>>> {
    return this.http.get<unknown>(`${this.baseUrl}/tickets`, {
      headers: this.headers,
      params: this.params(options.year, options)
    }).pipe(map((response) => this.normalizeListResponse(response)));
  }

  async listAllTickets(year: string, eventId?: string | null): Promise<Ticket[]> {
    const tickets: Ticket[] = [];
    let cursor: string | null = null;

    do {
      const response: ApiResponse<PaginatedResponse<Ticket>> = await firstValueFrom(this.listTickets({ year, eventId, limit: 500, cursor }));
      tickets.push(...response.data.items);
      cursor = response.data.nextCursor;
    } while (cursor);

    return tickets;
  }

  offlineManifest(year: string, eventId?: string | null): Observable<ApiResponse<OfflineManifest>> {
    return this.http.get<ApiResponse<OfflineManifest>>(`${this.baseUrl}/offline-manifest`, { headers: this.headers, params: this.params(year, { eventId }) });
  }

  createTicket(payload: { codigo: string; activada: boolean; bloqueada: boolean; oculto?: boolean; zoneId?: string | null }, year: string, eventId?: string | null): Observable<ApiResponse<Ticket>> {
    return this.http.post<ApiResponse<Ticket>>(`${this.baseUrl}/tickets`, payload, { headers: this.headers, params: this.params(year, { eventId }) });
  }

  updateTicket(codigo: string, payload: { activada?: boolean; bloqueada?: boolean; oculto?: boolean; zoneId?: string | null }, year: string, eventId?: string | null): Observable<ApiResponse<Ticket>> {
    return this.http.put<ApiResponse<Ticket>>(`${this.baseUrl}/tickets/${encodeURIComponent(codigo)}`, payload, { headers: this.headers, params: this.params(year, { eventId }) });
  }

  deleteTicket(codigo: string, year: string, eventId?: string | null): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/tickets/${encodeURIComponent(codigo)}`, { headers: this.headers, params: this.params(year, { eventId }) });
  }

  deleteBatch(batchId: string, year: string, eventId?: string | null): Observable<ApiResponse<{ batchId: string; deleted: number; validatedTickets: string[] }>> {
    return this.http.delete<ApiResponse<{ batchId: string; deleted: number; validatedTickets: string[] }>>(`${this.baseUrl}/tickets/batch/${encodeURIComponent(batchId)}`, { headers: this.headers, params: this.params(year, { eventId }) });
  }

  generateTickets(payload: { quantity: number; prefix?: string; fisica: boolean; oculto?: boolean; zoneId?: string | null }, year: string, eventId?: string | null): Observable<ApiResponse<TicketBatchResult>> {
    return this.http.post<ApiResponse<TicketBatchResult>>(`${this.baseUrl}/tickets/generate`, payload, { headers: this.headers, params: this.params(year, { eventId }) });
  }

  activateBatch(batchId: string, year: string, eventId?: string | null): Observable<ApiResponse<{ batchId: string; total: number; activatedCount: number }>> {
    return this.http.put<ApiResponse<{ batchId: string; total: number; activatedCount: number }>>(`${this.baseUrl}/tickets/batch/${encodeURIComponent(batchId)}/activate`, {}, { headers: this.headers, params: this.params(year, { eventId }) });
  }

  sendTicketsByEmail(payload: { email: string; code?: string; batchId?: string }, year: string, eventId?: string | null): Observable<ApiResponse<TicketEmailResult>> {
    return this.http.post<ApiResponse<TicketEmailResult>>(`${this.baseUrl}/tickets/email`, payload, { headers: this.headers, params: this.params(year, { eventId }) });
  }

  validate(code: string, year: string, eventId?: string | null, zoneId?: string | null): Observable<ApiResponse<TicketValidationResult>> {
    return new Observable<ApiResponse<TicketValidationResult>>((subscriber) => {
      const controller = new AbortController();
      this.validateAsync(code, year, eventId, zoneId, controller.signal)
        .then((response) => {
          subscriber.next(response);
          subscriber.complete();
        })
        .catch((error) => {
          if (!subscriber.closed) {
            subscriber.error(error);
          }
        });

      return () => controller.abort();
    });
  }

  syncOfflineValidations(payload: { deviceId: string; validations: OfflineSyncValidation[] }, year: string, eventId?: string | null): Promise<ApiResponse<OfflineSyncResult>> {
    return firstValueFrom(
      this.http.post<ApiResponse<OfflineSyncResult>>(`${this.baseUrl}/validate/offline-sync`, payload, { headers: this.headers, params: this.params(year, { eventId }) })
    );
  }

  async validateAsync(code: string, year: string, eventId?: string | null, zoneId?: string | null, signal?: AbortSignal): Promise<ApiResponse<TicketValidationResult>> {
    const params = this.params(year, { eventId }).toString();
    const response = await fetch(`${this.baseUrl}/validate?${params}`, {
      method: 'POST',
      headers: this.fetchHeaders(),
      body: JSON.stringify({ code, zoneId: zoneId || null }),
      signal
    });
    const raw = await this.readJsonResponse(response);
    if (!response.ok) {
      throw raw;
    }

    return this.normalizeValidationResponse(raw, code);
  }

  exportTickets(year: string, eventId?: string | null): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/tickets/export`, { headers: this.headers, params: this.params(year, { eventId }), responseType: 'blob' });
  }

  downloadPdf(year: string, target?: { code?: string; batchId?: string; eventId?: string | null }): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/tickets/pdf`, { headers: this.headers, params: this.params(year, target), responseType: 'blob' });
  }

  downloadPdfWithProgress(year: string, target?: { code?: string; batchId?: string; eventId?: string | null }): Observable<HttpEvent<Blob>> {
    return this.http.get(`${this.baseUrl}/tickets/pdf`, {
      headers: this.headers,
      observe: 'events',
      params: this.params(year, target),
      reportProgress: true,
      responseType: 'blob'
    });
  }

  listTracking(options: {
    year: string;
    limit: number;
    cursor?: string | null;
    search?: string;
    action?: string;
    actor?: string;
    ip?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Observable<ApiResponse<PaginatedResponse<TrackingLog>>> {
    return this.http.get<ApiResponse<PaginatedResponse<TrackingLog>>>(`${this.baseUrl}/tracking`, {
      headers: this.headers,
      params: this.params(options.year, options)
    });
  }

  getTrackingLog(id: number, year: string): Observable<ApiResponse<TrackingLog>> {
    return this.http.get<ApiResponse<TrackingLog>>(`${this.baseUrl}/tracking/${id}`, { headers: this.headers, params: this.params(year) });
  }

  listTrackingActions(year: string): Observable<ApiResponse<string[]>> {
    return this.http.get<ApiResponse<string[]>>(`${this.baseUrl}/tracking/actions`, { headers: this.headers, params: this.params(year) });
  }

  private normalizeListResponse(response: unknown): ApiResponse<PaginatedResponse<Ticket>> {
    const payload = this.findListPayload(response);
    return {
      ok: true,
      data: {
        items: payload.items,
        nextCursor: payload.nextCursor
      }
    };
  }

  private findListPayload(value: unknown): PaginatedResponse<Ticket> {
    if (Array.isArray(value)) {
      return { items: value as Ticket[], nextCursor: null };
    }

    if (!value || typeof value !== 'object') {
      return { items: [], nextCursor: null };
    }

    const candidate = value as { items?: unknown; nextCursor?: unknown; data?: unknown };
    if (Array.isArray(candidate.items)) {
      return {
        items: candidate.items as Ticket[],
        nextCursor: typeof candidate.nextCursor === 'string' ? candidate.nextCursor : null
      };
    }

    return this.findListPayload(candidate.data);
  }

  private normalizeValidationResponse(response: unknown, code: string): ApiResponse<TicketValidationResult> {
    const data = this.findValidationPayload(response, code);
    return { ok: true, data };
  }

  private findValidationPayload(value: unknown, code: string): TicketValidationResult {
    if (this.isValidationPayload(value)) {
      return this.normalizeValidationPayload(value, code);
    }

    if (value && typeof value === 'object') {
      const candidate = value as { data?: unknown };
      if ('data' in candidate) {
        return this.findValidationPayload(candidate.data, code);
      }
    }

    return {
      status: 'valid',
      codigo: code,
      message: 'Entrada validada correctamente.',
      ticket: null
    };
  }

  private isValidationPayload(value: unknown): value is TicketValidationResult | (Partial<TicketValidationResult> & { code?: string }) {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const candidate = value as { status?: unknown; codigo?: unknown; code?: unknown };
    return typeof candidate.status === 'string' && (typeof candidate.codigo === 'string' || typeof candidate.code === 'string');
  }

  private normalizeValidationPayload(value: TicketValidationResult | (Partial<TicketValidationResult> & { code?: string }), code: string): TicketValidationResult {
    const candidate = value as Partial<TicketValidationResult> & { code?: string };
    const status = this.normalizeValidationStatus(candidate.status);
    return {
      ...candidate,
      status,
      codigo: candidate.codigo || candidate.code || code,
      message: candidate.message || this.validationMessage(status),
      ticket: candidate.ticket ?? null
    };
  }

  private fetchHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = this.authService.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (environment.adminApiKey) {
      headers['x-admin-key'] = environment.adminApiKey;
    }
    return headers;
  }

  private async readJsonResponse(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private normalizeValidationStatus(status: unknown): TicketValidationResult['status'] {
    if (status === 'valid' || status === 'invalid' || status === 'inactive' || status === 'blocked' || status === 'used' || status === 'wrong_zone') {
      return status;
    }

    return 'invalid';
  }

  private validationMessage(status: TicketValidationResult['status']): string {
    switch (status) {
      case 'valid':
        return 'Entrada validada correctamente.';
      case 'used':
        return 'Entrada ya validada.';
      case 'inactive':
        return 'Entrada no activada.';
      case 'blocked':
        return 'Entrada bloqueada.';
      case 'wrong_zone':
        return 'Zona de acceso no valida.';
      default:
        return 'Validacion rechazada.';
    }
  }
}
