import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, NgZone, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { saveAs } from 'file-saver';

import { AdminStats, Ticket, TicketAccessZone, TicketEvent, TicketZoneSummary, TrackingLog } from '../../models/ticket.model';
import { TicketsAdminService } from '../../services/tickets-admin.service';
import { ValidarComponent } from '../validar/validar.component';

type Tab = 'generate' | 'tickets' | 'batches' | 'activate' | 'zones';
type BackofficeSection = 'tickets' | 'validar' | 'tracking';
const ACTIVE_EVENT_STORAGE_KEY = 'ffsj-tickets-active-event-id';
const DEFAULT_ZONE_COLOR = '#e00616';

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
  protected events: TicketEvent[] = [];
  protected zones: TicketAccessZone[] = [];
  protected zoneSummariesData: TicketZoneSummary[] = [];
  protected readonly zoneColorPalette = ['#e00616', '#0f766e', '#2563eb', '#7c3aed', '#c026d3', '#ea580c', '#ca8a04', '#16a34a', '#0f172a'];
  protected zonesLoading = false;
  protected activeEventId: string | null = sessionStorage.getItem(ACTIVE_EVENT_STORAGE_KEY);
  protected eventLoading = false;
  protected eventFormOpen = false;
  protected eventForm = { nombre: '', descripcion: '', fechaEvento: '', estado: 'activo' as 'activo' | 'finalizado' };
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

  protected zoneForm = { id: null as string | null, nombre: '', colorHex: DEFAULT_ZONE_COLOR };
  protected ticketForm = { codigo: '', activada: true, bloqueada: false, zoneId: '' };
  protected batchForm = { quantity: 25, prefix: 'FFSJ', fisica: true, zoneId: '' };
  protected emailForm = { email: '', code: '', batchId: '' };
  protected activationForm = { code: '' };

  ngOnInit(): void {
    const requestedSection = this.route.snapshot.queryParamMap.get('section');
    if (requestedSection === 'tracking' || requestedSection === 'validar') {
      this.section = requestedSection;
    }
    this.loadEvents();
  }

  protected refresh(): void {
    if (!this.activeEventId) {
      this.resetTicketContext();
      this.loadEvents();
      return;
    }
    this.loadStats();
    this.loadZones();
    this.loadZoneSummaryTickets();
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
    if (!this.requireActiveEvent()) return;
    if (!this.requireZoneSelection(this.ticketForm.zoneId)) return;
    const codigo = this.ticketForm.codigo.trim().toUpperCase();
    if (!codigo) {
      this.setMessage('Indica un codigo.', 'warning');
      return;
    }

    this.loading = true;
    this.ticketsAdminService.createTicket({ ...this.ticketForm, codigo, zoneId: this.normalizedZoneId(this.ticketForm.zoneId) }, this.year, this.activeEventId).subscribe({
      next: () => {
        this.ticketForm.codigo = '';
        this.setMessage('Entrada creada.', 'success');
        this.refresh();
      },
      error: (error) => this.handleError(error, 'No se ha podido crear la entrada.')
    });
  }

  protected generateBatch(): void {
    if (!this.requireActiveEvent()) return;
    if (!this.requireZoneSelection(this.batchForm.zoneId)) return;
    this.loading = true;
    this.ticketsAdminService.generateTickets({ ...this.batchForm, zoneId: this.normalizedZoneId(this.batchForm.zoneId) }, this.year, this.activeEventId).subscribe({
      next: ({ data }) => {
        this.emailForm.batchId = data.batchId;
        this.setMessage(`Lote ${data.batchId} generado con ${data.totalGenerated} entradas.`, 'success');
        this.refresh();
      },
      error: (error) => this.handleError(error, 'No se ha podido generar el lote.')
    });
  }

  protected sendEmail(): void {
    if (!this.requireActiveEvent()) return;
    const email = this.emailForm.email.trim();
    const code = this.emailForm.code.trim().toUpperCase();
    const batchId = this.emailForm.batchId.trim();
    if (!email || Boolean(code) === Boolean(batchId)) {
      this.setMessage('Indica email y un solo destino: codigo o lote.', 'warning');
      return;
    }

    this.loading = true;
    this.ticketsAdminService.sendTicketsByEmail({ email, ...(code ? { code } : {}), ...(batchId ? { batchId } : {}) }, this.year, this.activeEventId).subscribe({
      next: ({ data }) => {
        this.setMessage(`${data.sent} entradas enviadas a ${data.email}.`, 'success');
        this.loading = false;
      },
      error: (error) => this.handleError(error, 'No se ha podido enviar el email.')
    });
  }

  protected loadStats(): void {
    if (!this.activeEventId) return;
    this.ticketsAdminService.statsForEvent(this.year, this.activeEventId).subscribe({
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
    if (!this.activeEventId) {
      this.resetTicketContext();
      return;
    }
    if (reset) {
      this.cursor = null;
      this.tickets = [];
    }

    const mode = this.tab === 'batches' ? 'batch' : undefined;
    this.listLoading = true;
    this.ticketsAdminService.listTickets({
      year: this.year,
      eventId: this.activeEventId,
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

  protected loadZones(): void {
    if (!this.activeEventId) {
      this.zones = [];
      return;
    }
    const eventId = this.activeEventId;

    this.zonesLoading = true;
    this.ticketsAdminService.listZones(this.year, eventId).subscribe({
      next: ({ data }) => {
        this.applyViewUpdate(() => {
          this.zones = data;
          this.syncSelectedZones();
          this.zonesLoading = false;
        });
      },
      error: () => {
        this.applyViewUpdate(() => {
          this.zones = [];
          this.zonesLoading = false;
        });
      }
    });
  }

  protected loadZoneSummaryTickets(): void {
    if (!this.activeEventId) {
      this.zoneSummariesData = [];
      return;
    }

    this.ticketsAdminService.statsByZone(this.year, this.activeEventId).subscribe({
      next: ({ data }) => {
        this.applyViewUpdate(() => {
          this.zoneSummariesData = data;
        });
      },
      error: () => undefined
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
    if (!this.requireActiveEvent()) return;
    this.loading = true;
    this.ticketsAdminService.updateTicket(ticket.codigo, { activada: ticket.activada, bloqueada: ticket.bloqueada, zoneId: ticket.zoneId ?? null }, this.year, this.activeEventId).subscribe({
      next: () => {
        this.setMessage('Entrada actualizada.', 'success');
        this.refresh();
      },
      error: (error) => this.handleError(error, 'No se ha podido actualizar la entrada.')
    });
  }

  protected deleteTicket(ticket: Ticket): void {
    if (!this.requireActiveEvent()) return;
    if (!confirm(`Eliminar entrada ${ticket.codigo}?`)) {
      return;
    }
    this.loading = true;
    this.ticketsAdminService.deleteTicket(ticket.codigo, this.year, this.activeEventId).subscribe({
      next: () => {
        this.setMessage('Entrada eliminada.', 'success');
        this.refresh();
      },
      error: (error) => this.handleError(error, 'No se ha podido eliminar la entrada.')
    });
  }

  protected deleteBatch(batchId: string): void {
    if (!this.requireActiveEvent()) return;
    if (!confirm(`Eliminar lote ${batchId}?`)) {
      return;
    }

    this.loading = true;
    this.ticketsAdminService.deleteBatch(batchId, this.year, this.activeEventId).subscribe({
      next: ({ data }) => {
        this.expandedBatchId = null;
        this.setMessage(`Lote eliminado: ${data.deleted} entradas.`, 'success');
        this.refresh();
      },
      error: (error) => this.handleError(error, 'No se ha podido eliminar el lote.')
    });
  }

  protected activateBatch(batchId: string): void {
    if (!this.requireActiveEvent()) return;
    this.loading = true;
    this.ticketsAdminService.activateBatch(batchId, this.year, this.activeEventId).subscribe({
      next: ({ data }) => {
        this.setMessage(`Lote activado: ${data.activatedCount}/${data.total}.`, 'success');
        this.refresh();
      },
      error: (error) => this.handleError(error, 'No se ha podido activar el lote.')
    });
  }

  protected activateFromForm(): void {
    if (!this.requireActiveEvent()) return;
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

    this.ticketsAdminService.updateTicket(value.toUpperCase(), { activada: true }, this.year, this.activeEventId).subscribe({
      next: () => {
        this.setMessage('Entrada activada.', 'success');
        this.activationForm.code = '';
        this.refresh();
      },
      error: (error) => this.handleError(error, 'No se ha podido activar la entrada.')
    });
  }

  protected exportCsv(): void {
    if (!this.requireActiveEvent()) return;
    this.ticketsAdminService.exportTickets(this.year, this.activeEventId).subscribe((blob) => saveAs(blob, `tickets-${this.year}-${this.activeEventId}.csv`));
  }

  protected downloadPdf(ticket?: Ticket): void {
    if (!this.requireActiveEvent()) return;
    this.ticketsAdminService.downloadPdf(this.year, ticket ? { code: ticket.codigo, eventId: this.activeEventId } : { eventId: this.activeEventId }).subscribe((blob) => saveAs(blob, ticket ? `entrada-${ticket.codigo}.pdf` : `entradas-${this.year}.pdf`));
  }

  protected downloadBatchPdf(batchId: string): void {
    if (!this.requireActiveEvent()) return;
    this.ticketsAdminService.downloadPdf(this.year, { batchId, eventId: this.activeEventId }).subscribe((blob) => saveAs(blob, `entradas-${batchId}.pdf`));
  }

  protected get activeEvent(): TicketEvent | null {
    return this.events.find((event) => event.id === this.activeEventId) ?? null;
  }

  protected loadEvents(): void {
    this.eventLoading = true;
    this.ticketsAdminService.listEvents(this.year).subscribe({
      next: ({ data }) => {
        this.applyViewUpdate(() => {
          this.events = data;
          const storedExists = this.activeEventId && data.some((event) => event.id === this.activeEventId);
          this.activeEventId = storedExists ? this.activeEventId : data[0]?.id ?? null;
          if (this.activeEventId) {
            sessionStorage.setItem(ACTIVE_EVENT_STORAGE_KEY, this.activeEventId);
          }
          this.eventLoading = false;
          this.refresh();
        });
      },
      error: () => {
        this.applyViewUpdate(() => {
          this.eventLoading = false;
          this.setMessage('No se han podido cargar los eventos.', 'error');
        });
      }
    });
  }

  protected selectEvent(eventId: string): void {
    this.activeEventId = eventId;
    sessionStorage.setItem(ACTIVE_EVENT_STORAGE_KEY, eventId);
    this.currentPage = 1;
    this.expandedTicketCode = null;
    this.expandedBatchId = null;
    this.refresh();
  }

  protected createEvent(): void {
    const nombre = this.eventForm.nombre.trim();
    if (!nombre) {
      this.setMessage('Indica el nombre del evento.', 'warning');
      return;
    }
    this.eventLoading = true;
    this.ticketsAdminService.createEvent({
      nombre,
      descripcion: this.eventForm.descripcion.trim() || null,
      fechaEvento: this.eventForm.fechaEvento || null,
      estado: this.eventForm.estado
    }, this.year).subscribe({
      next: ({ data }) => {
        this.applyViewUpdate(() => {
          this.events = [data, ...this.events.filter((event) => event.id !== data.id)];
          this.eventForm = { nombre: '', descripcion: '', fechaEvento: '', estado: 'activo' };
          this.eventFormOpen = false;
          this.eventLoading = false;
          this.selectEvent(data.id);
          this.setMessage('Evento creado.', 'success');
        });
      },
      error: (error) => {
        this.eventLoading = false;
        this.handleError(error, 'No se ha podido crear el evento.');
      }
    });
  }

  protected saveZone(): void {
    if (!this.requireActiveEvent()) return;
    const eventId = this.activeEventId;
    if (!eventId) return;
    const nombre = this.zoneForm.nombre.trim();
    if (!nombre) {
      this.setMessage('Indica el nombre de la zona.', 'warning');
      return;
    }

    this.zonesLoading = true;
    const isEditing = Boolean(this.zoneForm.id);
    const request = this.zoneForm.id
      ? this.ticketsAdminService.updateZone(this.year, eventId, this.zoneForm.id, { nombre, colorHex: this.zoneForm.colorHex })
      : this.ticketsAdminService.createZone(this.year, eventId, { nombre, colorHex: this.zoneForm.colorHex });

    request.subscribe({
      next: () => {
        this.zoneForm = { id: null, nombre: '', colorHex: DEFAULT_ZONE_COLOR };
        this.setMessage(isEditing ? 'Zona actualizada.' : 'Zona creada.', 'success');
        this.loadZones();
      },
      error: (error) => {
        this.zonesLoading = false;
        this.handleError(error, 'No se ha podido guardar la zona.');
      }
    });
  }

  protected editZone(zone: TicketAccessZone): void {
    this.zoneForm = { id: zone.id, nombre: zone.nombre, colorHex: zone.colorHex || DEFAULT_ZONE_COLOR };
  }

  protected cancelZoneEdit(): void {
    this.zoneForm = { id: null, nombre: '', colorHex: DEFAULT_ZONE_COLOR };
  }

  protected selectZoneColor(colorHex: string): void {
    this.zoneForm.colorHex = colorHex;
  }

  protected deleteZone(zone: TicketAccessZone): void {
    if (!this.requireActiveEvent()) return;
    const eventId = this.activeEventId;
    if (!eventId) return;
    if (!confirm(`Eliminar zona ${zone.nombre}?`)) {
      return;
    }

    this.zonesLoading = true;
    this.ticketsAdminService.deleteZone(this.year, eventId, zone.id).subscribe({
      next: () => {
        this.cancelZoneEdit();
        this.setMessage('Zona eliminada.', 'success');
        this.loadZones();
        this.loadZoneSummaryTickets();
      },
      error: (error) => {
        this.zonesLoading = false;
        this.handleError(error, 'No se ha podido eliminar la zona.');
      }
    });
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

  protected get hasZones(): boolean {
    return this.zones.length > 0;
  }

  protected get zoneSummaries(): TicketZoneSummary[] {
    return this.zoneSummariesData.slice().sort((a, b) => {
      if (a.zoneId === null) return 1;
      if (b.zoneId === null) return -1;
      return a.zoneName.localeCompare(b.zoneName);
    });
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

  private requireActiveEvent(): boolean {
    if (this.activeEventId) {
      return true;
    }
    this.setMessage('Selecciona o crea un evento antes de gestionar entradas.', 'warning');
    return false;
  }

  private resetTicketContext(): void {
    this.stats = { totalEntradas: 0, totalActivadas: 0, totalValidadas: 0, totalBloqueadas: 0, totalLotes: 0 };
    this.tickets = [];
    this.zoneSummariesData = [];
    this.zones = [];
    this.cursor = null;
    this.listLoading = false;
  }

  private normalizedZoneId(zoneId: string | null | undefined): string | null {
    return zoneId && zoneId.trim() ? zoneId : null;
  }

  private requireZoneSelection(zoneId: string): boolean {
    if (!this.hasZones || this.normalizedZoneId(zoneId)) {
      return true;
    }

    this.setMessage('Selecciona una zona de acceso.', 'warning');
    return false;
  }

  private syncSelectedZones(): void {
    const defaultZoneId = this.zones[0]?.id ?? '';
    if (this.zones.length === 0) {
      this.ticketForm.zoneId = '';
      this.batchForm.zoneId = '';
      return;
    }

    if (!this.zones.some((zone) => zone.id === this.ticketForm.zoneId)) {
      this.ticketForm.zoneId = defaultZoneId;
    }
    if (!this.zones.some((zone) => zone.id === this.batchForm.zoneId)) {
      this.batchForm.zoneId = defaultZoneId;
    }
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
