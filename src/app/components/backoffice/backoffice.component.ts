import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, NgZone, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { saveAs } from 'file-saver';

import { AdminStats, Ticket, TrackingLog } from '../../models/ticket.model';
import { TicketsAdminService } from '../../services/tickets-admin.service';
import { ValidarComponent } from '../validar/validar.component';

type Tab = 'generate' | 'tickets' | 'batches' | 'activate';
type BackofficeSection = 'tickets' | 'validar' | 'tracking';

@Component({
  selector: 'app-backoffice',
  standalone: true,
  imports: [CommonModule, FormsModule, ValidarComponent],
  templateUrl: './backoffice.component.html',
  styleUrl: './backoffice.component.scss'
})
export class BackofficeComponent implements OnInit {
  private readonly ticketsAdminService = inject(TicketsAdminService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly ngZone = inject(NgZone);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected year = String(new Date().getFullYear());
  protected section: BackofficeSection = 'tickets';
  protected tab: Tab = 'generate';
  protected loading = false;
  protected message = '';
  protected messageTone: 'success' | 'error' | 'warning' | 'info' | 'neutral' = 'neutral';
  protected listLoading = false;
  protected stats: AdminStats = { totalEntradas: 0, totalActivadas: 0, totalValidadas: 0, totalBloqueadas: 0, totalLotes: 0 };
  protected tickets: Ticket[] = [];
  protected cursor: string | null = null;
  protected status = 'all';
  protected search = '';
  protected pageSize = 4;
  protected currentPage = 1;
  protected expandedTicketCode: string | null = null;
  protected expandedBatchId: string | null = null;
  protected trackingLogs: TrackingLog[] = [];
  protected trackingCursor: string | null = null;
  protected trackingLoading = false;
  protected trackingFiltersOpen = false;
  protected expandedTrackingId: number | null = null;
  protected trackingActions: string[] = [];
  protected trackingFilters = {
    search: '',
    action: '',
    actor: '',
    ip: '',
    dateFrom: '',
    dateTo: ''
  };

  protected ticketForm = { codigo: '', activada: true, bloqueada: false };
  protected batchForm = { quantity: 25, prefix: 'FFSJ', fisica: true };
  protected emailForm = { email: '', code: '', batchId: '' };
  protected activationForm = { code: '' };

  ngOnInit(): void {
    const requestedSection = this.route.snapshot.queryParamMap.get('section');
    if (requestedSection === 'tracking' || requestedSection === 'validar') {
      this.section = requestedSection;
    }
    this.refresh();
  }

  protected refresh(): void {
    this.loadStats();
    if (this.section === 'tracking') {
      this.loadTracking(true);
      this.loadTrackingActions();
    } else if (this.section === 'validar') {
      return;
    } else {
      this.loadTickets(true);
    }
  }

  protected setSection(section: BackofficeSection): void {
    this.section = section;
    this.message = '';
    if (section === 'tracking') {
      this.loadTracking(true);
      this.loadTrackingActions();
    } else if (section === 'validar') {
      return;
    } else {
      this.loadTickets(true);
    }
  }

  protected setTab(tab: Tab): void {
    this.tab = tab;
    this.currentPage = 1;
    this.expandedTicketCode = null;
    this.expandedBatchId = null;
    this.loadTickets(true);
  }

  protected createTicket(): void {
    const codigo = this.ticketForm.codigo.trim().toUpperCase();
    if (!codigo) {
      this.setMessage('Indica un codigo.', 'warning');
      return;
    }

    this.loading = true;
    this.ticketsAdminService.createTicket({ ...this.ticketForm, codigo }, this.year).subscribe({
      next: () => {
        this.ticketForm.codigo = '';
        this.setMessage('Entrada creada.', 'success');
        this.refresh();
      },
      error: (error) => this.handleError(error, 'No se ha podido crear la entrada.')
    });
  }

  protected generateBatch(): void {
    this.loading = true;
    this.ticketsAdminService.generateTickets(this.batchForm, this.year).subscribe({
      next: ({ data }) => {
        this.emailForm.batchId = data.batchId;
        this.setMessage(`Lote ${data.batchId} generado con ${data.totalGenerated} entradas.`, 'success');
        this.refresh();
      },
      error: (error) => this.handleError(error, 'No se ha podido generar el lote.')
    });
  }

  protected sendEmail(): void {
    const email = this.emailForm.email.trim();
    const code = this.emailForm.code.trim().toUpperCase();
    const batchId = this.emailForm.batchId.trim();
    if (!email || Boolean(code) === Boolean(batchId)) {
      this.setMessage('Indica email y un solo destino: codigo o lote.', 'warning');
      return;
    }

    this.loading = true;
    this.ticketsAdminService.sendTicketsByEmail({ email, ...(code ? { code } : {}), ...(batchId ? { batchId } : {}) }, this.year).subscribe({
      next: ({ data }) => {
        this.setMessage(`${data.sent} entradas enviadas a ${data.email}.`, 'success');
        this.loading = false;
      },
      error: (error) => this.handleError(error, 'No se ha podido enviar el email.')
    });
  }

  protected loadStats(): void {
    this.ticketsAdminService.stats(this.year).subscribe({
      next: ({ data }) => {
        this.applyViewUpdate(() => {
          this.stats = data;
        });
      },
      error: () => {
        this.setMessage('No se han podido cargar las estadisticas.', 'error');
      }
    });
  }

  protected loadTickets(reset = false): void {
    if (reset) {
      this.cursor = null;
      this.tickets = [];
    }

    const mode = this.tab === 'batches' ? 'batch' : undefined;
    this.listLoading = true;
    this.ticketsAdminService.listTickets({
      year: this.year,
      limit: 50,
      cursor: this.cursor,
      status: this.status === 'all' ? undefined : this.status,
      search: this.search,
      mode
    }).subscribe({
      next: (response) => {
        this.applyViewUpdate(() => {
          this.tickets = reset ? response.data.items : [...this.tickets, ...response.data.items];
          this.cursor = response.data.nextCursor;
          this.currentPage = Math.min(this.currentPage, this.totalPages);
          this.listLoading = false;
        });
      },
      error: () => {
        this.applyViewUpdate(() => {
          this.listLoading = false;
          this.setMessage('No se han podido cargar las entradas.', 'error');
        });
      }
    });
  }

  protected loadTracking(reset = false): void {
    if (reset) {
      this.trackingCursor = null;
      this.trackingLogs = [];
      this.expandedTrackingId = null;
    }

    this.trackingLoading = true;
    this.ticketsAdminService.listTracking({
      year: this.year,
      limit: 30,
      cursor: this.trackingCursor,
      ...this.trackingFilters
    }).subscribe({
      next: ({ data }) => {
        this.applyViewUpdate(() => {
          this.trackingLogs = reset ? data.items : [...this.trackingLogs, ...data.items];
          this.trackingCursor = data.nextCursor;
          this.trackingLoading = false;
        });
      },
      error: () => {
        this.applyViewUpdate(() => {
          this.trackingLoading = false;
          this.setMessage('No se han podido cargar los eventos de tracking.', 'error');
        });
      }
    });
  }

  protected loadTrackingActions(): void {
    this.ticketsAdminService.listTrackingActions(this.year).subscribe({
      next: ({ data }) => {
        this.applyViewUpdate(() => {
          this.trackingActions = data;
        });
      }
    });
  }

  protected saveTicket(ticket: Ticket): void {
    this.loading = true;
    this.ticketsAdminService.updateTicket(ticket.codigo, { activada: ticket.activada, bloqueada: ticket.bloqueada }, this.year).subscribe({
      next: () => {
        this.setMessage('Entrada actualizada.', 'success');
        this.refresh();
      },
      error: (error) => this.handleError(error, 'No se ha podido actualizar la entrada.')
    });
  }

  protected deleteTicket(ticket: Ticket): void {
    if (!confirm(`Eliminar entrada ${ticket.codigo}?`)) {
      return;
    }
    this.loading = true;
    this.ticketsAdminService.deleteTicket(ticket.codigo, this.year).subscribe({
      next: () => {
        this.setMessage('Entrada eliminada.', 'success');
        this.refresh();
      },
      error: (error) => this.handleError(error, 'No se ha podido eliminar la entrada.')
    });
  }

  protected deleteBatch(batchId: string): void {
    if (!confirm(`Eliminar lote ${batchId}?`)) {
      return;
    }

    this.loading = true;
    this.ticketsAdminService.deleteBatch(batchId, this.year).subscribe({
      next: ({ data }) => {
        this.expandedBatchId = null;
        this.setMessage(`Lote eliminado: ${data.deleted} entradas.`, 'success');
        this.refresh();
      },
      error: (error) => this.handleError(error, 'No se ha podido eliminar el lote.')
    });
  }

  protected activateBatch(batchId: string): void {
    this.loading = true;
    this.ticketsAdminService.activateBatch(batchId, this.year).subscribe({
      next: ({ data }) => {
        this.setMessage(`Lote activado: ${data.activatedCount}/${data.total}.`, 'success');
        this.refresh();
      },
      error: (error) => this.handleError(error, 'No se ha podido activar el lote.')
    });
  }

  protected activateFromForm(): void {
    const value = this.activationForm.code.trim();
    if (!value) {
      this.setMessage('Indica un codigo de entrada o lote.', 'warning');
      return;
    }

    this.loading = true;
    const hyphenCount = (value.match(/-/g) ?? []).length;
    if (hyphenCount >= 4) {
      this.activateBatch(value);
      return;
    }

    this.ticketsAdminService.updateTicket(value.toUpperCase(), { activada: true }, this.year).subscribe({
      next: () => {
        this.setMessage('Entrada activada.', 'success');
        this.activationForm.code = '';
        this.refresh();
      },
      error: (error) => this.handleError(error, 'No se ha podido activar la entrada.')
    });
  }

  protected exportCsv(): void {
    this.ticketsAdminService.exportTickets(this.year).subscribe((blob) => saveAs(blob, `tickets-${this.year}.csv`));
  }

  protected downloadPdf(ticket?: Ticket): void {
    this.ticketsAdminService.downloadPdf(this.year, ticket ? { code: ticket.codigo } : undefined).subscribe((blob) => saveAs(blob, ticket ? `entrada-${ticket.codigo}.pdf` : `entradas-${this.year}.pdf`));
  }

  protected downloadBatchPdf(batchId: string): void {
    this.ticketsAdminService.downloadPdf(this.year, { batchId }).subscribe((blob) => saveAs(blob, `entradas-${batchId}.pdf`));
  }

  protected get batchSummaries(): Array<{ batchId: string; total: number; active: number; validated: number; tickets: Ticket[] }> {
    const grouped = new Map<string, Ticket[]>();
    this.tickets.filter((ticket) => ticket.batchId).forEach((ticket) => {
      grouped.set(ticket.batchId!, [...(grouped.get(ticket.batchId!) ?? []), ticket]);
    });
    return Array.from(grouped.entries()).map(([batchId, tickets]) => ({
      batchId,
      total: tickets.length,
      active: tickets.filter((ticket) => ticket.activada).length,
      validated: tickets.filter((ticket) => ticket.usada).length,
      tickets
    }));
  }

  protected get filteredTickets(): Ticket[] {
    return this.tickets;
  }

  protected get visibleTickets(): Ticket[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredTickets.slice(start, start + this.pageSize);
  }

  protected get visibleBatches(): Array<{ batchId: string; total: number; active: number; validated: number; tickets: Ticket[] }> {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.batchSummaries.slice(start, start + this.pageSize);
  }

  protected get totalPages(): number {
    const total = this.tab === 'batches' ? this.batchSummaries.length : this.filteredTickets.length;
    return Math.max(1, Math.ceil(total / this.pageSize));
  }

  protected toggleTicket(ticket: Ticket): void {
    this.expandedTicketCode = this.expandedTicketCode === ticket.codigo ? null : ticket.codigo;
  }

  protected toggleBatch(batchId: string): void {
    this.expandedBatchId = this.expandedBatchId === batchId ? null : batchId;
  }

  protected ticketStatusLabel(ticket: Ticket): string {
    if (ticket.usada) {
      return 'Validada';
    }
    if (ticket.bloqueada) {
      return 'Bloqueada';
    }
    if (ticket.activada) {
      return 'Activada';
    }
    return 'Pendiente';
  }

  protected ticketStatusClass(ticket: Ticket): string {
    if (ticket.usada) {
      return 'status-chip-ok';
    }
    if (ticket.bloqueada) {
      return 'status-chip-blocked';
    }
    if (ticket.activada) {
      return 'status-chip-blue';
    }
    return '';
  }

  protected ticketCardClass(ticket: Ticket): string {
    if (ticket.usada) {
      return 'record-card-success';
    }
    if (ticket.bloqueada) {
      return 'record-card-danger';
    }
    if (ticket.activada) {
      return 'record-card-info';
    }
    return 'record-card-neutral';
  }

  protected nextPage(): void {
    this.currentPage = Math.min(this.totalPages, this.currentPage + 1);
  }

  protected toggleTracking(log: TrackingLog): void {
    this.expandedTrackingId = this.expandedTrackingId === log.id ? null : log.id;
  }

  protected openTrackingDetail(log: TrackingLog): void {
    void this.router.navigate(['/backoffice/tracking', log.id], { queryParams: { year: this.year } });
  }

  protected clearTrackingFilters(): void {
    this.trackingFilters = { search: '', action: '', actor: '', ip: '', dateFrom: '', dateTo: '' };
    this.trackingFiltersOpen = false;
    this.loadTracking(true);
  }

  protected trackingMetadataPreview(log: TrackingLog): string {
    if (!log.metadata) {
      return 'Sin metadatos';
    }
    const text = JSON.stringify(log.metadata);
    return text.length > 160 ? `${text.slice(0, 160)}...` : text;
  }

  protected trackingToneClass(log: TrackingLog): string {
    return `tracking-card-${this.trackingTone(log)}`;
  }

  protected trackingStatusClass(log: TrackingLog): string {
    return `tracking-status-${this.trackingTone(log)}`;
  }

  protected previousPage(): void {
    this.currentPage = Math.max(1, this.currentPage - 1);
  }

  private handleError(error: unknown, fallback: string): void {
    const response = error as { error?: { error?: { message?: string } } };
    this.setMessage(response.error?.error?.message || fallback, 'error');
  }

  private applyViewUpdate(update: () => void): void {
    this.ngZone.run(() => {
      update();
      this.changeDetectorRef.detectChanges();
    });
  }

  private setMessage(message: string, tone: 'success' | 'error' | 'warning' | 'info' | 'neutral' = 'neutral'): void {
    this.message = message;
    this.messageTone = tone;
    this.loading = false;
    this.changeDetectorRef.detectChanges();
  }

  private trackingTone(log: TrackingLog): 'success' | 'error' | 'warning' | 'info' | 'neutral' {
    const action = `${log.action || ''} ${log.status || ''} ${log.message || ''}`.toLowerCase();

    if (/(error|fail|failed|invalid|rechaz|denied|unauthorized)/.test(action)) {
      return 'error';
    }
    if (/(delete|deleted|remove|removed|borr|elimin|block|blocked|bloque|cancel)/.test(action)) {
      return 'error';
    }
    if (/(warn|warning|used|already|inactive|pendiente|duplic)/.test(action)) {
      return 'warning';
    }
    if (/(email|mail|export|download|pdf|csv|list|read|detail|info)/.test(action)) {
      return 'info';
    }
    if (/(ok|success|create|created|generate|generated|activate|activated|validate|validated|update|updated)/.test(action)) {
      return 'success';
    }
    return 'neutral';
  }
}
