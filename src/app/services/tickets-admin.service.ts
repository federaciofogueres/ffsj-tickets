import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { AdminStats, ApiResponse, PaginatedResponse, Ticket, TicketBatchResult, TicketEmailResult, TicketValidationResult } from '../models/ticket.model';
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

  me(): Observable<ApiResponse<{ id: string; label: string; year: string }>> {
    return this.http.get<ApiResponse<{ id: string; label: string; year: string }>>(`${this.baseUrl}/me`, { headers: this.headers });
  }

  stats(year: string): Observable<ApiResponse<AdminStats>> {
    return this.http.get<ApiResponse<AdminStats>>(`${this.baseUrl}/stats`, { headers: this.headers, params: this.params(year) });
  }

  listTickets(options: { year: string; limit: number; cursor?: string | null; status?: string; search?: string; mode?: 'single' | 'batch' }): Observable<ApiResponse<PaginatedResponse<Ticket>>> {
    return this.http.get<unknown>(`${this.baseUrl}/tickets`, {
      headers: this.headers,
      params: this.params(options.year, options)
    }).pipe(map((response) => this.normalizeListResponse(response)));
  }

  createTicket(payload: { codigo: string; activada: boolean; bloqueada: boolean }, year: string): Observable<ApiResponse<Ticket>> {
    return this.http.post<ApiResponse<Ticket>>(`${this.baseUrl}/tickets`, payload, { headers: this.headers, params: this.params(year) });
  }

  updateTicket(codigo: string, payload: { activada?: boolean; bloqueada?: boolean }, year: string): Observable<ApiResponse<Ticket>> {
    return this.http.put<ApiResponse<Ticket>>(`${this.baseUrl}/tickets/${encodeURIComponent(codigo)}`, payload, { headers: this.headers, params: this.params(year) });
  }

  deleteTicket(codigo: string, year: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/tickets/${encodeURIComponent(codigo)}`, { headers: this.headers, params: this.params(year) });
  }

  deleteBatch(batchId: string, year: string): Observable<ApiResponse<{ batchId: string; deleted: number; validatedTickets: string[] }>> {
    return this.http.delete<ApiResponse<{ batchId: string; deleted: number; validatedTickets: string[] }>>(`${this.baseUrl}/tickets/batch/${encodeURIComponent(batchId)}`, { headers: this.headers, params: this.params(year) });
  }

  generateTickets(payload: { quantity: number; prefix?: string; fisica: boolean }, year: string): Observable<ApiResponse<TicketBatchResult>> {
    return this.http.post<ApiResponse<TicketBatchResult>>(`${this.baseUrl}/tickets/generate`, payload, { headers: this.headers, params: this.params(year) });
  }

  activateBatch(batchId: string, year: string): Observable<ApiResponse<{ batchId: string; total: number; activatedCount: number }>> {
    return this.http.put<ApiResponse<{ batchId: string; total: number; activatedCount: number }>>(`${this.baseUrl}/tickets/batch/${encodeURIComponent(batchId)}/activate`, {}, { headers: this.headers, params: this.params(year) });
  }

  sendTicketsByEmail(payload: { email: string; code?: string; batchId?: string }, year: string): Observable<ApiResponse<TicketEmailResult>> {
    return this.http.post<ApiResponse<TicketEmailResult>>(`${this.baseUrl}/tickets/email`, payload, { headers: this.headers, params: this.params(year) });
  }

  validate(code: string, year: string): Observable<ApiResponse<TicketValidationResult>> {
    return this.http.post<ApiResponse<TicketValidationResult>>(`${this.baseUrl}/validate`, { code }, { headers: this.headers, params: this.params(year) });
  }

  exportTickets(year: string): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/tickets/export`, { headers: this.headers, params: this.params(year), responseType: 'blob' });
  }

  downloadPdf(year: string, target?: { code?: string; batchId?: string }): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/tickets/pdf`, { headers: this.headers, params: this.params(year, target), responseType: 'blob' });
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
}
