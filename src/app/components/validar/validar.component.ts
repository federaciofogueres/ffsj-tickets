import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, Input, NgZone, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { BarcodeFormat } from '@zxing/library';
import { ZXingScannerModule } from '@zxing/ngx-scanner';

import { TicketAccessZone, TicketValidationResult } from '../../models/ticket.model';
import { TicketsAdminService } from '../../services/tickets-admin.service';
import { environment } from '../../../environments/environment';

const VALIDATION_TIMEOUT_MS = 15000;

@Component({
  selector: 'app-validar',
  standalone: true,
  imports: [CommonModule, FormsModule, ZXingScannerModule],
  templateUrl: './validar.component.html',
  styleUrl: './validar.component.scss'
})
export class ValidarComponent implements OnDestroy, OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly ticketsAdminService = inject(TicketsAdminService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly ngZone = inject(NgZone);

  protected readonly formats = [BarcodeFormat.QR_CODE];
  protected year = String(new Date().getFullYear());
  protected code = '';
  protected scannerOpen = false;
  protected loading = false;
  protected result: TicketValidationResult | null = null;
  protected debugOpen = true;
  protected debugEntries: string[] = [];
  private lastScanned = '';
  private accessZones: TicketAccessZone[] = [];
  private reopenScannerAfterResult = false;
  private validationRun = 0;
  private validationWatchdogId: number | null = null;
  private readonly unhandledRejectionHandler = (event: PromiseRejectionEvent) => {
    const message = this.debugString(this.errorDebugInfo(event.reason));
    if (!message.includes('setPhotoOptions')) {
      return;
    }

    event.preventDefault();
    this.ngZone.run(() => {
      this.addDebug(`global camera promise ignored ${message}`);
      this.changeDetectorRef.detectChanges();
    });
  };

  @Input() embedded = false;
  @Input() eventId: string | null = sessionStorage.getItem('ffsj-tickets-active-event-id');
  @Input() selectedZoneId = '';

  @Input()
  set zones(value: TicketAccessZone[] | null | undefined) {
    this.accessZones = value ?? [];
    if (!this.accessZones.some((zone) => zone.id === this.selectedZoneId)) {
      this.selectedZoneId = this.accessZones[0]?.id ?? '';
    }
  }

  get zones(): TicketAccessZone[] {
    return this.accessZones;
  }

  @Input()
  set selectedYear(value: string | number | null | undefined) {
    if (value) {
      this.year = String(value);
    }
  }

  constructor() {
    window.addEventListener('unhandledrejection', this.unhandledRejectionHandler);

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

  ngOnInit(): void {
    this.loadZonesIfNeeded();
  }

  ngOnDestroy(): void {
    window.removeEventListener('unhandledrejection', this.unhandledRejectionHandler);
    this.clearValidationWatchdog();
  }

  protected onScan(value: string): void {
    if (this.loading || this.result || this.lastScanned === value) {
      this.addDebug(`scan ignored loading=${this.loading} result=${!!this.result} duplicate=${this.lastScanned === value}`);
      return;
    }
    this.lastScanned = value;
    this.addDebug(`scan success raw=${this.debugString(value)}`);
    this.validate(value, true);
    window.setTimeout(() => {
      this.lastScanned = '';
      this.addDebug('scan duplicate guard cleared');
    }, 1800);
  }

  protected async validate(rawCode = this.code, reopenScannerAfterResult = false): Promise<void> {
    this.addDebug(`validate start raw=${this.debugString(rawCode)}`);
    const code = this.extractCode(rawCode);
    this.addDebug(`extracted code=${code || '(empty)'}`);
    if (!code) {
      this.result = { status: 'invalid', codigo: '', message: 'No se ha leido ningun codigo.', ticket: null };
      this.addDebug('validate stopped: empty code');
      return;
    }

    this.loading = true;
    this.reopenScannerAfterResult = reopenScannerAfterResult;
    this.code = code;
    if (this.hasZones && !this.selectedZoneId) {
      this.result = { status: 'wrong_zone', codigo: code, message: 'Selecciona la zona de acceso del validador.', ticket: null };
      this.loading = false;
      this.addDebug('validate stopped: missing validator zone');
      return;
    }
    const runId = ++this.validationRun;
    const controller = new AbortController();
    this.startValidationWatchdog(runId, code);
    this.addDebug(`request POST ${environment.adminApiBaseUrl}/validate year=${this.year} eventId=${this.eventId || '(none)'} zoneId=${this.selectedZoneId || '(none)'}`);

    const abortId = window.setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);
    try {
      const response = await this.ticketsAdminService.validateAsync(code, this.year, this.eventId, this.selectedZoneId || null, controller.signal);
      this.ngZone.run(() => {
        if (this.validationRun !== runId) {
          this.addDebug(`response ignored stale run=${runId}`);
          return;
        }
        this.addDebug(`response next ${this.debugString(response)}`);
        this.result = response.data;
      });
    } catch (error) {
      this.ngZone.run(() => {
        this.addDebug(`response error ${this.debugString(this.errorDebugInfo(error))}`);
        this.result = {
          status: 'invalid',
          codigo: code,
          message: this.validationErrorMessage(error),
          ticket: null
        };
      });
    } finally {
      window.clearTimeout(abortId);
      this.ngZone.run(() => {
        if (this.validationRun === runId) {
          this.clearValidationWatchdog();
          this.loading = false;
          this.addDebug('request finally loading=false');
        }
        this.changeDetectorRef.detectChanges();
      });
    }
  }

  protected forceCloseLoading(): void {
    this.loading = false;
    this.addDebug('loading force-closed by user');
    if (!this.result && this.code) {
      this.result = {
        status: 'invalid',
        codigo: this.code,
        message: 'Carga cerrada manualmente. La API puede haber respondido; revisa Network o el listado.',
        ticket: null
      };
    }
    this.changeDetectorRef.detectChanges();
  }

  protected clearResult(): void {
    this.result = null;
    this.addDebug('result closed');
    if (this.reopenScannerAfterResult) {
      this.scannerOpen = true;
      this.reopenScannerAfterResult = false;
      this.addDebug('scanner reopened after result');
    }
  }

  protected clearDebug(): void {
    this.debugEntries = [];
  }

  protected onScanError(error: Error): void {
    this.addDebug(`scan error ${this.debugString(this.errorDebugInfo(error))}`);
  }

  protected onPermissionResponse(hasPermission: boolean): void {
    this.addDebug(`camera permission=${hasPermission}`);
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

  protected get hasZones(): boolean {
    return this.zones.length > 0;
  }

  protected get selectedZoneName(): string {
    return this.zones.find((zone) => zone.id === this.selectedZoneId)?.nombre || 'Sin zona';
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

  private addDebug(message: string): void {
    const time = new Date().toLocaleTimeString('es-ES', { hour12: false });
    this.debugEntries = [`${time} ${message}`, ...this.debugEntries].slice(0, 30);
  }

  private debugString(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private errorDebugInfo(error: unknown): unknown {
    if (!error || typeof error !== 'object') {
      return error;
    }

    const candidate = error as {
      name?: unknown;
      message?: unknown;
      status?: unknown;
      statusText?: unknown;
      url?: unknown;
      error?: unknown;
    };

    return {
      name: candidate.name,
      message: candidate.message,
      status: candidate.status,
      statusText: candidate.statusText,
      url: candidate.url,
      error: candidate.error
    };
  }

  private validationErrorMessage(error: unknown): string {
    if (error && typeof error === 'object') {
      const candidate = error as { error?: { error?: { message?: unknown }; message?: unknown }; message?: unknown };
      const message = candidate.error?.error?.message ?? candidate.error?.message ?? candidate.message;
      if (typeof message === 'string' && message.trim()) {
        return message;
      }
    }

    return 'No se ha podido validar la entrada.';
  }

  private startValidationWatchdog(runId: number, code: string): void {
    this.clearValidationWatchdog();
    this.validationWatchdogId = window.setTimeout(() => {
      this.ngZone.run(() => {
        if (!this.loading || this.validationRun !== runId) {
          return;
        }

        this.loading = false;
        this.addDebug(`native watchdog stopped loading after ${VALIDATION_TIMEOUT_MS}ms`);
        this.result = {
          status: 'invalid',
          codigo: code,
          message: 'La validacion no ha devuelto resultado en el tiempo esperado. Revisa el log de debug.',
          ticket: null
        };
        this.changeDetectorRef.detectChanges();
      });
    }, VALIDATION_TIMEOUT_MS);
  }

  private clearValidationWatchdog(): void {
    if (this.validationWatchdogId === null) {
      return;
    }

    window.clearTimeout(this.validationWatchdogId);
    this.validationWatchdogId = null;
  }

  private loadZonesIfNeeded(): void {
    if (this.accessZones.length || !this.eventId) {
      return;
    }

    this.ticketsAdminService.listZones(this.year, this.eventId).subscribe({
      next: ({ data }) => {
        this.zones = data;
        this.changeDetectorRef.detectChanges();
      },
      error: () => undefined
    });
  }
}
