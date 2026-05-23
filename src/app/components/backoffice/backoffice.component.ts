import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, NgZone, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { saveAs } from 'file-saver';

import { AdminStats, Ticket } from '../../models/ticket.model';
import { TicketsAdminService } from '../../services/tickets-admin.service';

type Tab = 'generate' | 'tickets' | 'batches' | 'activate';

@Component({
  selector: 'app-backoffice',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './backoffice.component.html',
  styleUrl: './backoffice.component.scss'
})
export class BackofficeComponent implements OnInit {
  private readonly ticketsAdminService = inject(TicketsAdminService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly ngZone = inject(NgZone);

  protected year = String(new Date().getFullYear());
  protected tab: Tab = 'generate';
  protected loading = false;
  protected message = '';
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

  protected ticketForm = { codigo: '', activada: true, bloqueada: false };
  protected batchForm = { quantity: 25, prefix: 'FFSJ', fisica: true };
  protected emailForm = { email: '', code: '', batchId: '' };
  protected activationForm = { code: '' };

  ngOnInit(): void {
    this.refresh();
  }

  protected refresh(): void {
    this.loadStats();
    this.loadTickets(true);
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
      this.setMessage('Indica un codigo.');
      return;
    }

    this.loading = true;
    this.ticketsAdminService.createTicket({ ...this.ticketForm, codigo }, this.year).subscribe({
      next: () => {
        this.ticketForm.codigo = '';
        this.setMessage('Entrada creada.');
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
        this.setMessage(`Lote ${data.batchId} generado con ${data.totalGenerated} entradas.`);
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
      this.setMessage('Indica email y un solo destino: codigo o lote.');
      return;
    }

    this.loading = true;
    this.ticketsAdminService.sendTicketsByEmail({ email, ...(code ? { code } : {}), ...(batchId ? { batchId } : {}) }, this.year).subscribe({
      next: ({ data }) => {
        this.setMessage(`${data.sent} entradas enviadas a ${data.email}.`);
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
        this.setMessage('No se han podido cargar las estadisticas.');
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
          this.setMessage('No se han podido cargar las entradas.');
        });
      }
    });
  }

  protected saveTicket(ticket: Ticket): void {
    this.loading = true;
    this.ticketsAdminService.updateTicket(ticket.codigo, { activada: ticket.activada, bloqueada: ticket.bloqueada }, this.year).subscribe({
      next: () => {
        this.setMessage('Entrada actualizada.');
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
        this.setMessage('Entrada eliminada.');
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
        this.setMessage(`Lote eliminado: ${data.deleted} entradas.`);
        this.refresh();
      },
      error: (error) => this.handleError(error, 'No se ha podido eliminar el lote.')
    });
  }

  protected activateBatch(batchId: string): void {
    this.loading = true;
    this.ticketsAdminService.activateBatch(batchId, this.year).subscribe({
      next: ({ data }) => {
        this.setMessage(`Lote activado: ${data.activatedCount}/${data.total}.`);
        this.refresh();
      },
      error: (error) => this.handleError(error, 'No se ha podido activar el lote.')
    });
  }

  protected activateFromForm(): void {
    const value = this.activationForm.code.trim();
    if (!value) {
      this.setMessage('Indica un codigo de entrada o lote.');
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
        this.setMessage('Entrada activada.');
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

  protected nextPage(): void {
    this.currentPage = Math.min(this.totalPages, this.currentPage + 1);
  }

  protected previousPage(): void {
    this.currentPage = Math.max(1, this.currentPage - 1);
  }

  private handleError(error: unknown, fallback: string): void {
    const response = error as { error?: { error?: { message?: string } } };
    this.setMessage(response.error?.error?.message || fallback);
  }

  private applyViewUpdate(update: () => void): void {
    this.ngZone.run(() => {
      update();
      this.changeDetectorRef.detectChanges();
    });
  }

  private setMessage(message: string): void {
    this.message = message;
    this.loading = false;
    this.changeDetectorRef.detectChanges();
  }
}
