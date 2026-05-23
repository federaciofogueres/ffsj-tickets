import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { BarcodeFormat } from '@zxing/library';
import { ZXingScannerModule } from '@zxing/ngx-scanner';

import { TicketValidationResult } from '../../models/ticket.model';
import { TicketsAdminService } from '../../services/tickets-admin.service';

@Component({
  selector: 'app-validar',
  standalone: true,
  imports: [CommonModule, FormsModule, ZXingScannerModule],
  templateUrl: './validar.component.html',
  styleUrl: './validar.component.scss'
})
export class ValidarComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly ticketsAdminService = inject(TicketsAdminService);

  protected readonly formats = [BarcodeFormat.QR_CODE];
  protected year = String(new Date().getFullYear());
  protected code = '';
  protected scannerOpen = true;
  protected loading = false;
  protected result: TicketValidationResult | null = null;
  private lastScanned = '';

  constructor() {
    const queryCode = this.route.snapshot.queryParamMap.get('code');
    const queryYear = this.route.snapshot.queryParamMap.get('year');
    if (queryYear) {
      this.year = queryYear;
    }
    if (queryCode) {
      this.code = queryCode;
      this.validate(queryCode);
    }
  }

  protected onScan(value: string): void {
    if (this.loading || this.lastScanned === value) {
      return;
    }
    this.lastScanned = value;
    this.validate(value);
    window.setTimeout(() => {
      this.lastScanned = '';
    }, 1800);
  }

  protected validate(rawCode = this.code): void {
    const code = this.extractCode(rawCode);
    if (!code) {
      this.result = { status: 'invalid', codigo: '', message: 'No se ha leido ningun codigo.', ticket: null };
      return;
    }

    this.loading = true;
    this.code = code;
    this.ticketsAdminService.validate(code, this.year).subscribe({
      next: ({ data }) => {
        this.result = data;
        this.loading = false;
      },
      error: (error) => {
        this.result = {
          status: 'invalid',
          codigo: code,
          message: error?.error?.error?.message || 'No se ha podido validar la entrada.',
          ticket: null
        };
        this.loading = false;
      }
    });
  }

  private extractCode(value: string): string {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      return '';
    }

    try {
      const url = new URL(trimmed);
      return (url.searchParams.get('code') || url.searchParams.get('codigo') || url.pathname.split('/').filter(Boolean).at(-1) || '').trim().toUpperCase();
    } catch {
      return trimmed.toUpperCase();
    }
  }
}
