import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TrackingLog } from '../../models/ticket.model';
import { TicketsAdminService } from '../../services/tickets-admin.service';

@Component({
  selector: 'app-tracking-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './tracking-detail.component.html',
  styleUrl: './tracking-detail.component.scss'
})
export class TrackingDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly ticketsAdminService = inject(TicketsAdminService);

  protected year = String(new Date().getFullYear());
  protected log: TrackingLog | null = null;
  protected loading = true;
  protected error = '';

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.year = this.route.snapshot.queryParamMap.get('year') || this.year;
    if (!id) {
      this.loading = false;
      this.error = 'Evento no valido.';
      return;
    }

    this.ticketsAdminService.getTrackingLog(id, this.year).subscribe({
      next: ({ data }) => {
        this.log = data;
        this.loading = false;
      },
      error: () => {
        this.error = 'No se ha podido cargar el detalle del evento.';
        this.loading = false;
      }
    });
  }

  protected metadata(): string {
    return JSON.stringify(this.log?.metadata ?? null, null, 2);
  }
}
