import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../environments/environment';
import { ApiResponse, PublicTicketView } from '../models/ticket.model';

@Injectable({ providedIn: 'root' })
export class PublicTicketService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/tickets/public`;

  getTicket(accessCode: string): Observable<ApiResponse<PublicTicketView>> {
    return this.http.get<ApiResponse<PublicTicketView>>(`${this.baseUrl}/${encodeURIComponent(accessCode)}`);
  }
}
