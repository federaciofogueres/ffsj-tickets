import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { PublicTicketView } from '../../models/ticket.model';
import { PublicTicketService } from '../../services/public-ticket.service';

@Component({
  selector: 'app-public-ticket',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './public-ticket.component.html',
  styleUrl: './public-ticket.component.scss'
})
export class PublicTicketComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly publicTicketService = inject(PublicTicketService);

  protected loading = true;
  protected error = '';
  protected ticket: PublicTicketView | null = null;

  ngOnInit(): void {
    const accessCode = this.route.snapshot.paramMap.get('accessCode')?.trim() ?? '';
    if (!accessCode) {
      this.loading = false;
      this.error = 'El enlace de la entrada no es valido.';
      return;
    }

    this.publicTicketService.getTicket(accessCode).subscribe({
      next: (response) => {
        this.ticket = response.data;
        this.loading = false;
      },
      error: () => {
        this.error = 'No se ha podido cargar esta entrada. Revisa el enlace recibido por email.';
        this.loading = false;
      }
    });
  }

  protected get statusLabel(): string {
    switch (this.ticket?.status) {
      case 'available':
        return 'Entrada disponible';
      case 'inactive':
        return 'Entrada no activada';
      case 'blocked':
        return 'Entrada bloqueada';
      case 'used':
        return 'Entrada ya utilizada';
      default:
        return 'Entrada no disponible';
    }
  }

  protected get statusClass(): string {
    return `ticket-status-${this.ticket?.status ?? 'invalid'}`;
  }
}
