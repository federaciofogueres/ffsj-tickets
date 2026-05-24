import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, NgZone, OnInit, inject } from '@angular/core';
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
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly ngZone = inject(NgZone);

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
      next: (response) => {
        this.applyViewUpdate(() => {
          this.log = this.normalizeLogResponse(response);
          this.loading = false;
          if (!this.log) {
            this.error = 'La API no ha devuelto informacion del evento.';
          }
        });
      },
      error: () => {
        this.applyViewUpdate(() => {
          this.error = 'No se ha podido cargar el detalle del evento.';
          this.loading = false;
        });
      }
    });
  }

  protected metadata(): string {
    return JSON.stringify(this.log?.metadata ?? null, null, 2);
  }

  protected rawEvent(): string {
    return JSON.stringify(this.log ?? null, null, 2);
  }

  private normalizeLogResponse(response: unknown): TrackingLog | null {
    const maybeResponse = response as { data?: unknown };
    const data = maybeResponse?.data ?? response;
    if (!data || typeof data !== 'object') {
      return null;
    }
    return data as TrackingLog;
  }

  private applyViewUpdate(update: () => void): void {
    this.ngZone.run(() => {
      update();
      this.changeDetectorRef.detectChanges();
    });
  }
}
