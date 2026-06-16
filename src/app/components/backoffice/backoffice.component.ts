import { CommonModule } from '@angular/common';
import { HttpEventType } from '@angular/common/http';
import { ChangeDetectorRef, Component, NgZone, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { saveAs } from 'file-saver';

import { AdminStats, BackofficeAdminContext, BackofficeAssociationModulePermissions, BackofficeModuleKey, Ticket, TicketAccessZone, TicketEvent, TicketZoneSummary, TrackingLog } from '../../models/ticket.model';
import { TicketsAdminService } from '../../services/tickets-admin.service';
import { ValidarComponent } from '../validar/validar.component';

type Tab = 'generate' | 'tickets' | 'batches' | 'activate' | 'zones';
type BackofficeSection = 'tickets' | 'hiddenTickets' | 'validar' | 'tracking' | 'modules';
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
  protected loadingMessage = '';
  protected pdfLoading = false;
  protected pdfProgress: number | null = null;
  protected pdfLoadingMessage = '';
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
  protected eventForm = { nombre: '', descripcion: '', fechaEvento: '', horaEvento: '', estado: 'activo' as 'activo' | 'finalizado' | 'inactivo' };
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
  protected validationForm = { code: '', zoneId: '' };
  protected hiddenTicketForm = { codigo: '', activada: true, bloqueada: false, zoneId: '' };
  protected hiddenBatchForm = { quantity: 10, prefix: 'OCULTO', fisica: false, zoneId: '' };
  protected adminContext: BackofficeAdminContext | null = null;
  protected modulePermissions: BackofficeAssociationModulePermissions[] = [];
  protected selectedModuleCargoId = '';
  protected selectedPermissionModules: BackofficeModuleKey[] = [];
  protected loadingModulePermissions = false;
  protected readonly moduleOptions: Array<{ key: BackofficeModuleKey; label: string; description: string; icon: string }> = [
    { key: 'tickets', label: 'Tickets', description: 'Gestion, listados, lotes, PDF y zonas de entradas visibles.', icon: 'bi-ticket-perforated' },
    { key: 'hiddenTickets', label: 'Tickets ocultos', description: 'Generacion y operativa de entradas que no aparecen en listados ni totales normales.', icon: 'bi-incognito' },
    { key: 'validar', label: 'Validar', description: 'Camara y validacion manual de entradas por codigo o QR.', icon: 'bi-qr-code-scan' },
    { key: 'tracking', label: 'Tracking', description: 'Auditoria de acciones administrativas y consultas de trazabilidad.', icon: 'bi-activity' }
  ];

  ngOnInit(): void {
    const requestedSection = this.route.snapshot.queryParamMap.get('section');
    if (requestedSection === 'tracking' || requestedSection === 'validar' || requestedSection === 'hiddenTickets' || requestedSection === 'modules') {
      this.section = requestedSection;
    }
    if (this.section !== 'modules' && !this.isModuleEnabled(this.section)) {
      this.section = this.firstEnabledSection();
    }
    this.loadAdminContext();
  }

  protected loadAdminContext(): void {
    this.ticketsAdminService.me().subscribe({
      next: ({ data }) => {
        this.applyViewUpdate(() => {
          this.adminContext = data;
          if (this.section === 'modules' && !data.isSuperAdmin) {
            this.section = this.firstEnabledSection();
          }
          if (this.section !== 'modules' && !this.isModuleEnabled(this.section)) {
            this.section = this.firstEnabledSection();
          }
        });
        this.loadEvents();
        if (data.isSuperAdmin) {
          this.loadModulePermissions();
        }
      },
      error: () => {
        this.loadEvents();
      }
    });
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
    } else if (this.section === 'validar' || this.section === 'modules') {
      return;
    } else {
      this.loadTickets(true);
    }
  }

  protected setSection(section: BackofficeSection): void {
    if (section === 'modules' && !this.adminContext?.isSuperAdmin) {
      this.setMessage('Solo el superadmin puede administrar modulos.', 'warning');
      return;
    }
    if (section !== 'modules' && !this.isModuleEnabled(section)) {
      this.setMessage('Modulo desactivado para administracion.', 'warning');
      return;
    }
    this.section = section;
    this.message = '';
    if (section === 'hiddenTickets') {
      this.tab = 'tickets';
      this.currentPage = 1;
      this.expandedTicketCode = null;
      this.expandedBatchId = null;
    }
    if (section === 'tracking') {
      this.loadTracking(true);
      this.loadTrackingActions();
    } else if (section === 'validar' || section === 'modules') {
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

    this.beginOperation('Creando entrada...');
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
    this.beginOperation(`Generando ${this.batchForm.quantity} entradas...`);
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

    this.beginOperation(batchId ? `Enviando lote ${batchId} por email...` : `Enviando entrada ${code} por email...`);
    this.ticketsAdminService.sendTicketsByEmail({ email, ...(code ? { code } : {}), ...(batchId ? { batchId } : {}) }, this.year, this.activeEventId).subscribe({
      next: ({ data }) => {
        this.setMessage(`${data.sent} entradas enviadas a ${data.email}.`, 'success');
      },
      error: (error) => this.handleError(error, 'No se ha podido enviar el email.')
    });
  }

  protected prepareTicketEmail(ticket: Ticket): void {
    this.emailForm = { email: this.emailForm.email, code: ticket.codigo, batchId: '' };
    this.openEmailProcess(`Preparado envio por email para la entrada ${ticket.codigo}.`);
  }

  protected prepareBatchEmail(batchId: string): void {
    this.emailForm = { email: this.emailForm.email, code: '', batchId };
    this.openEmailProcess(`Preparado envio por email para el lote ${batchId}.`);
  }

  protected async copyBatchId(batchId: string): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(batchId);
      } else {
        this.copyTextFallback(batchId);
      }
      this.setMessage('ID de lote copiado.', 'success');
    } catch {
      this.setMessage('No se ha podido copiar el ID del lote.', 'error');
    }
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
      mode,
      visibility: this.section === 'hiddenTickets' ? 'hidden' : 'visible'
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
    this.beginOperation(`Guardando entrada ${ticket.codigo}...`);
    this.ticketsAdminService.updateTicket(ticket.codigo, { activada: ticket.activada, bloqueada: ticket.bloqueada, oculto: ticket.oculto, zoneId: ticket.zoneId ?? null }, this.year, this.activeEventId).subscribe({
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
    this.beginOperation(`Eliminando entrada ${ticket.codigo}...`);
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

    this.beginOperation(`Eliminando lote ${batchId}...`);
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
    this.beginOperation(`Activando lote ${batchId}...`);
    this.ticketsAdminService.activateBatch(batchId, this.year, this.activeEventId).subscribe({
      next: ({ data }) => {
        this.setMessage(`Lote activado: ${data.activatedCount}/${data.total}.`, 'success');
        this.refresh();
      },
      error: (error) => this.handleError(error, 'No se ha podido activar el lote.')
    });
  }

  protected validateFromForm(): void {
    if (!this.requireActiveEvent()) return;
    if (!this.requireZoneSelection(this.validationForm.zoneId)) return;
    const value = this.validationForm.code.trim();
    if (!value) {
      this.setMessage('Indica un codigo de entrada o lote.', 'warning');
      return;
    }

    this.beginOperation('Validando entrada...');
    this.ticketsAdminService.validate(value, this.year, this.activeEventId, this.normalizedZoneId(this.validationForm.zoneId)).subscribe({
      next: ({ data }) => {
        this.setMessage(data.message, data.status === 'valid' ? 'success' : data.status === 'used' ? 'info' : 'warning');
        this.validationForm.code = '';
        this.refresh();
      },
      error: (error) => this.handleError(error, 'No se ha podido validar la entrada.')
    });
  }

  protected createHiddenTicket(): void {
    if (!this.requireActiveEvent()) return;
    if (!this.requireZoneSelection(this.hiddenTicketForm.zoneId)) return;
    const codigo = this.hiddenTicketForm.codigo.trim().toUpperCase();
    if (!codigo) {
      this.setMessage('Indica un codigo.', 'warning');
      return;
    }

    this.beginOperation('Creando entrada oculta...');
    this.ticketsAdminService.createTicket({
      ...this.hiddenTicketForm,
      codigo,
      oculto: true,
      zoneId: this.normalizedZoneId(this.hiddenTicketForm.zoneId)
    }, this.year, this.activeEventId).subscribe({
      next: () => {
        this.hiddenTicketForm.codigo = '';
        this.setMessage('Entrada oculta creada.', 'success');
        this.refresh();
      },
      error: (error) => this.handleError(error, 'No se ha podido crear la entrada oculta.')
    });
  }

  protected generateHiddenBatch(): void {
    if (!this.requireActiveEvent()) return;
    if (!this.requireZoneSelection(this.hiddenBatchForm.zoneId)) return;
    this.beginOperation(`Generando ${this.hiddenBatchForm.quantity} entradas ocultas...`);
    this.ticketsAdminService.generateTickets({
      ...this.hiddenBatchForm,
      oculto: true,
      zoneId: this.normalizedZoneId(this.hiddenBatchForm.zoneId)
    }, this.year, this.activeEventId).subscribe({
      next: ({ data }) => {
        this.setMessage(`Lote oculto ${data.batchId} generado con ${data.totalGenerated} entradas.`, 'success');
        this.refresh();
      },
      error: (error) => this.handleError(error, 'No se ha podido generar el lote oculto.')
    });
  }

  protected toggleModule(key: BackofficeModuleKey): void {
    const exists = this.selectedPermissionModules.includes(key);
    const next = exists ? this.selectedPermissionModules.filter((module) => module !== key) : [...this.selectedPermissionModules, key];
    if (!next.length) {
      this.setMessage('Debe quedar al menos un modulo activo.', 'warning');
      return;
    }
    this.selectedPermissionModules = next;
  }

  protected isModuleEnabled(section: BackofficeModuleKey): boolean {
    if (!this.adminContext) {
      return true;
    }
    return this.adminContext.allowedModules.includes(section);
  }

  protected isSelectedPermissionModule(key: BackofficeModuleKey): boolean {
    return this.selectedPermissionModules.includes(key);
  }

  protected loadModulePermissions(): void {
    if (!this.adminContext?.isSuperAdmin) return;
    this.loadingModulePermissions = true;
    this.ticketsAdminService.listModulePermissions().subscribe({
      next: ({ data }) => {
        this.applyViewUpdate(() => {
          this.modulePermissions = data.permissions;
          this.loadingModulePermissions = false;
          if (!this.selectedModuleCargoId && this.modulePermissions[0]) {
            this.selectModulePermission(this.modulePermissions[0]);
          }
        });
      },
      error: (error) => {
        this.loadingModulePermissions = false;
        this.handleError(error, 'No se han podido cargar los permisos de modulos.');
      }
    });
  }

  protected selectModulePermission(permission: BackofficeAssociationModulePermissions): void {
    this.selectedModuleCargoId = permission.cargoId;
    this.selectedPermissionModules = permission.modules.filter((module): module is BackofficeModuleKey => module !== 'modules');
  }

  protected saveModulePermissions(): void {
    const cargoId = this.selectedModuleCargoId.trim();
    if (!cargoId) {
      this.setMessage('Indica el ID cargo.', 'warning');
      return;
    }
    if (!this.selectedPermissionModules.length) {
      this.setMessage('Selecciona al menos un modulo.', 'warning');
      return;
    }

    this.beginOperation(`Guardando modulos para cargo ${cargoId}...`);
    this.ticketsAdminService.updateModulePermissions(cargoId, this.selectedPermissionModules).subscribe({
      next: ({ data }) => {
        const existingIndex = this.modulePermissions.findIndex((permission) => permission.cargoId === data.cargoId);
        this.modulePermissions = existingIndex >= 0
          ? this.modulePermissions.map((permission, index) => index === existingIndex ? data : permission)
          : [...this.modulePermissions, data];
        this.selectModulePermission(data);
        this.setMessage('Permisos de modulos actualizados.', 'success');
      },
      error: (error) => this.handleError(error, 'No se han podido guardar los permisos de modulos.')
    });
  }

  protected exportCsv(): void {
    if (!this.requireActiveEvent()) return;
    this.beginOperation('Exportando CSV...');
    this.ticketsAdminService.exportTickets(this.year, this.activeEventId).subscribe({
      next: (blob) => {
        saveAs(blob, `tickets-${this.year}-${this.activeEventId}.csv`);
        this.setMessage('CSV exportado correctamente.', 'success');
      },
      error: (error) => this.handleError(error, 'No se ha podido exportar el CSV.')
    });
  }

  protected downloadPdf(ticket?: Ticket): void {
    if (!this.requireActiveEvent()) return;
    this.downloadPdfTarget(
      ticket ? { code: ticket.codigo, eventId: this.activeEventId } : { eventId: this.activeEventId },
      ticket ? `entrada-${ticket.codigo}.pdf` : `entradas-${this.year}.pdf`,
      ticket ? `Generando PDF de ${ticket.codigo}...` : 'Generando PDF de entradas...'
    );
  }

  protected downloadBatchPdf(batchId: string): void {
    if (!this.requireActiveEvent()) return;
    this.downloadPdfTarget(
      { batchId, eventId: this.activeEventId },
      `entradas-${batchId}.pdf`,
      `Generando PDF del lote ${batchId}...`
    );
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
    this.beginOperation('Guardando evento...');
    this.ticketsAdminService.createEvent({
      nombre,
      descripcion: this.eventForm.descripcion.trim() || null,
      fechaEvento: this.eventForm.fechaEvento || null,
      horaEvento: this.eventForm.horaEvento || null,
      estado: this.eventForm.estado
    }, this.year).subscribe({
      next: ({ data }) => {
        this.applyViewUpdate(() => {
          this.events = [data, ...this.events.filter((event) => event.id !== data.id)];
          this.eventForm = { nombre: '', descripcion: '', fechaEvento: '', horaEvento: '', estado: 'activo' };
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

  protected deactivateEvent(): void {
    const event = this.activeEvent;
    if (!event) {
      this.setMessage('Selecciona un evento antes de borrarlo.', 'warning');
      return;
    }
    if (event.estado === 'inactivo') {
      this.setMessage('El evento ya esta inactivo.', 'info');
      return;
    }
    if (!confirm(`Borrar evento "${event.nombre}"? Se marcara como inactivo.`)) {
      return;
    }

    this.eventLoading = true;
    this.beginOperation(`Borrando evento ${event.nombre}...`);
    this.ticketsAdminService.updateEvent(event.id, { estado: 'inactivo' }, this.year).subscribe({
      next: ({ data }) => {
        this.applyViewUpdate(() => {
          this.events = this.events.map((item) => item.id === data.id ? data : item);
          this.eventLoading = false;
          this.setMessage('Evento marcado como inactivo.', 'success');
        });
      },
      error: (error) => {
        this.eventLoading = false;
        this.handleError(error, 'No se ha podido borrar el evento.');
      }
    });
  }

  protected eventOptionClass(event: TicketEvent): string {
    return event.estado === 'inactivo' ? 'inactive-event-option' : '';
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
    this.beginOperation(this.zoneForm.id ? 'Guardando zona...' : 'Creando zona...');
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
    this.beginOperation(`Eliminando zona ${zone.nombre}...`);
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

  private beginOperation(message: string): void {
    this.loading = true;
    this.loadingMessage = message;
    this.changeDetectorRef.detectChanges();
  }

  private downloadPdfTarget(target: { code?: string; batchId?: string; eventId?: string | null }, filename: string, message: string): void {
    if (this.pdfLoading) return;

    this.pdfLoading = true;
    this.pdfProgress = null;
    this.pdfLoadingMessage = message;
    this.changeDetectorRef.detectChanges();

    this.ticketsAdminService.downloadPdfWithProgress(this.year, target).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.DownloadProgress && event.total) {
          this.pdfProgress = Math.round((event.loaded / event.total) * 100);
          this.changeDetectorRef.detectChanges();
          return;
        }
        if (event.type === HttpEventType.Response && event.body) {
          saveAs(event.body, filename);
          this.pdfLoading = false;
          this.pdfProgress = null;
          this.pdfLoadingMessage = '';
          this.setMessage('PDF generado correctamente.', 'success');
        }
      },
      error: (error) => {
        this.pdfLoading = false;
        this.pdfProgress = null;
        this.pdfLoadingMessage = '';
        this.handleError(error, 'No se ha podido generar el PDF.');
      }
    });
  }

  private openEmailProcess(message: string): void {
    this.tab = 'generate';
    this.currentPage = 1;
    this.expandedTicketCode = null;
    this.expandedBatchId = null;
    this.setMessage(message, 'info');
  }

  private copyTextFallback(text: string): void {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
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
    this.loadingMessage = '';
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
      this.validationForm.zoneId = '';
      this.hiddenTicketForm.zoneId = '';
      this.hiddenBatchForm.zoneId = '';
      return;
    }

    if (!this.zones.some((zone) => zone.id === this.ticketForm.zoneId)) {
      this.ticketForm.zoneId = defaultZoneId;
    }
    if (!this.zones.some((zone) => zone.id === this.batchForm.zoneId)) {
      this.batchForm.zoneId = defaultZoneId;
    }
    if (!this.zones.some((zone) => zone.id === this.validationForm.zoneId)) {
      this.validationForm.zoneId = defaultZoneId;
    }
    if (!this.zones.some((zone) => zone.id === this.hiddenTicketForm.zoneId)) {
      this.hiddenTicketForm.zoneId = defaultZoneId;
    }
    if (!this.zones.some((zone) => zone.id === this.hiddenBatchForm.zoneId)) {
      this.hiddenBatchForm.zoneId = defaultZoneId;
    }
  }

  private firstEnabledSection(): BackofficeModuleKey {
    return this.moduleOptions.find((option) => this.isModuleEnabled(option.key))?.key ?? 'tickets';
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
