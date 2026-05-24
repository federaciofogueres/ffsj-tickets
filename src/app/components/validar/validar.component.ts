import { CommonModule } from '@angular/common';
import { Component, Input, inject } from '@angular/core';
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
  protected scannerOpen = false;
  protected loading = false;
  protected result: TicketValidationResult | null = null;
  private lastScanned = '';
  private reopenScannerAfterResult = false;

  @Input() embedded = false;

  @Input()
  set selectedYear(value: string | number | null | undefined) {
    if (value) {
      this.year = String(value);
    }
  }

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
    this.validate(value, true);
    window.setTimeout(() => {
      this.lastScanned = '';
    }, 1800);
  }

  protected validate(rawCode = this.code, reopenScannerAfterResult = false): void {
    const code = this.extractCode(rawCode);
    if (!code) {
      this.result = { status: 'invalid', codigo: '', message: 'No se ha leido ningun codigo.', ticket: null };
      return;
    }

    this.loading = true;
    this.scannerOpen = false;
    this.reopenScannerAfterResult = reopenScannerAfterResult;
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

  protected clearResult(): void {
    this.result = null;
    if (this.reopenScannerAfterResult) {
      this.scannerOpen = true;
      this.reopenScannerAfterResult = false;
    }
  }

  protected get resultTone(): 'success' | 'warning' | 'error' {
    if (this.result?.status === 'valid') {
      return 'success';
    }
    if (this.result?.status === 'used') {
      return 'warning';
    }
    return 'error';
  }

  protected get resultTitle(): string {
    if (this.resultTone === 'success') {
      return this.result?.summary?.type === 'batch' ? 'Lote validado' : 'Entrada validada';
    }
    if (this.resultTone === 'warning') {
      return this.result?.summary?.type === 'batch' ? 'Lote ya validado' : 'Entrada ya validada';
    }
    return 'Validacion rechazada';
  }

  protected get validationTime(): string | null {
    return this.result?.summary?.validatedAt ?? this.result?.ticket?.validatedAt ?? this.result?.ticket?.usadaAt ?? null;
  }

  protected get activationTime(): string | null {
    return this.result?.ticket?.activadaAt ?? null;
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
