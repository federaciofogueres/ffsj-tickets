import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, Input, NgZone, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { BarcodeFormat } from '@zxing/library';
import { ZXingScannerModule } from '@zxing/ngx-scanner';
import { firstValueFrom } from 'rxjs';

import { TicketAccessZone, TicketValidationResult } from '../../models/ticket.model';
import { TicketsAdminService } from '../../services/tickets-admin.service';
import { environment } from '../../../environments/environment';
import { OfflineManifestSummary, OfflineValidationService } from '../../services/offline-validation.service';

const VALIDATION_ATTEMPT_TIMEOUT_MS = 4000;
const MAX_ONLINE_VALIDATION_ATTEMPTS = 5;
const RETRY_PAUSE_MS = 650;

@Component({
  selector: 'app-validar',
  standalone: true,
  imports: [CommonModule, FormsModule, ZXingScannerModule],
  templateUrl: './validar.component.html',
  styleUrl: './validar.component.scss'
})
export class ValidarComponent implements OnDestroy, OnInit {
  @ViewChild('scannerRoot') scannerRoot?: ElementRef<HTMLElement>;

  private readonly route = inject(ActivatedRoute);
  private readonly ticketsAdminService = inject(TicketsAdminService);
  private readonly offlineValidationService = inject(OfflineValidationService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly ngZone = inject(NgZone);

  protected readonly formats = [BarcodeFormat.QR_CODE];
  protected readonly videoConstraints: MediaTrackConstraints = {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 }
  };
  protected year = String(new Date().getFullYear());
  protected code = '';
  protected scannerOpen = false;
  protected loading = false;
  protected offlinePreparing = false;
  protected offlineSyncing = false;
  protected result: TicketValidationResult | null = null;
  protected offlineSummary: OfflineManifestSummary | null = null;
  protected validationAttemptMessage = '';
  protected networkMode: 'online' | 'weak' | 'offline' = 'online';
  protected debugOpen = true;
  protected debugEntries: string[] = [];
  protected availableDevices: MediaDeviceInfo[] = [];
  protected selectedDevice?: MediaDeviceInfo;
  protected zoomSupported = false;
  protected zoomMin = 1;
  protected zoomMax = 1;
  protected zoomStep = 0.1;
  protected zoomValue = 1;
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
    this.refreshOfflineSummary();
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
    this.startValidationWatchdog(runId, code);
    this.addDebug(`request POST ${environment.adminApiBaseUrl}/validate year=${this.year} eventId=${this.eventId || '(none)'} zoneId=${this.selectedZoneId || '(none)'}`);

    try {
      const response = await this.validateOnlineWithRetries(code, this.selectedZoneId || null);
      this.ngZone.run(() => {
        if (this.validationRun !== runId) {
          this.addDebug(`response ignored stale run=${runId}`);
          return;
        }
        this.addDebug(`response next ${this.debugString(response)}`);
        this.networkMode = 'online';
        this.offlineValidationService.markServerValidation(this.year, this.eventId, response.data);
        this.refreshOfflineSummary();
        this.result = response.data;
      });
    } catch (error) {
      this.ngZone.run(() => {
        this.addDebug(`response error ${this.debugString(this.errorDebugInfo(error))}`);
        const localResult = this.offlineValidationService.validateLocal(code, this.year, this.eventId, this.selectedZoneId || null);
        this.networkMode = localResult.source === 'local' ? 'offline' : 'weak';
        this.refreshOfflineSummary();
        this.result = localResult.source === 'local'
          ? localResult.result
          : {
              status: 'invalid',
              codigo: code,
              message: this.validationErrorMessage(error),
              ticket: null
            };
      });
    } finally {
      this.ngZone.run(() => {
        if (this.validationRun === runId) {
          this.clearValidationWatchdog();
          this.loading = false;
          this.validationAttemptMessage = '';
          this.addDebug('request finally loading=false');
        }
        this.changeDetectorRef.detectChanges();
      });
    }
  }

  protected async prepareOfflineMode(): Promise<void> {
    if (this.offlinePreparing) {
      return;
    }

    this.offlinePreparing = true;
    this.addDebug('offline manifest download started');
    try {
      const manifest = await firstValueFrom(this.ticketsAdminService.offlineManifest(this.year, this.eventId));
      const { tickets, zones } = manifest.data;
      this.offlineSummary = this.offlineValidationService.saveApiManifest(manifest.data);
      if (!this.accessZones.length && zones.length) {
        this.zones = zones;
      }
      this.addDebug(`offline manifest ready tickets=${tickets.length} zones=${zones.length} checksum=${manifest.data.checksum}`);
    } catch (error) {
      this.addDebug(`offline manifest endpoint error ${this.debugString(this.errorDebugInfo(error))}`);
      await this.prepareOfflineModeLegacy();
    } finally {
      this.offlinePreparing = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  protected async syncOfflinePending(): Promise<void> {
    if (this.offlineSyncing || !this.offlineSummary?.pending) {
      return;
    }

    this.offlineSyncing = true;
    this.addDebug(`offline sync started pending=${this.offlineSummary.pending}`);
    try {
      const summary = await this.offlineValidationService.syncPending(
        this.year,
        this.eventId,
        (validations, deviceId) => this.ticketsAdminService.syncOfflineValidations({ deviceId, validations }, this.year, this.eventId)
      );
      this.refreshOfflineSummary();
      this.addDebug(`offline sync done attempted=${summary.attempted} synced=${summary.synced} conflicts=${summary.conflicts} failed=${summary.failed}`);
      this.result = {
        status: summary.failed ? 'invalid' : 'valid',
        codigo: '',
        message: `Sincronizacion: ${summary.synced} enviadas, ${summary.conflicts} conflictos, ${summary.failed} pendientes.`,
        ticket: null
      };
    } catch (error) {
      this.addDebug(`offline sync endpoint error ${this.debugString(this.errorDebugInfo(error))}`);
      await this.syncOfflinePendingLegacy();
    } finally {
      this.offlineSyncing = false;
      this.validationAttemptMessage = '';
      this.changeDetectorRef.detectChanges();
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

  protected handleCamerasFound(devices: MediaDeviceInfo[]): void {
    this.availableDevices = devices.filter((device) => device.kind === 'videoinput');
    this.selectedDevice = this.pickPreferredCamera(this.availableDevices);
    window.setTimeout(() => this.inspectCameraCapabilities(), 350);
  }

  protected handleDeviceChange(device: MediaDeviceInfo): void {
    this.selectedDevice = device;
    window.setTimeout(() => this.inspectCameraCapabilities(), 350);
  }

  protected switchCamera(): void {
    if (this.availableDevices.length < 2) {
      return;
    }

    const currentIndex = this.availableDevices.findIndex((device) => device.deviceId === this.selectedDevice?.deviceId);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % this.availableDevices.length : 0;
    this.selectedDevice = this.availableDevices[nextIndex];
  }

  protected resetZoom(): void {
    if (!this.zoomSupported) {
      return;
    }

    this.zoomValue = this.zoomMin;
    this.applyZoom();
  }

  protected applyZoom(): void {
    const track = this.getActiveVideoTrack();
    if (!track || !this.zoomSupported) {
      return;
    }

    void track.applyConstraints({
      advanced: [{ zoom: this.zoomValue } as MediaTrackConstraintSet]
    } as MediaTrackConstraints);
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
    if (this.offlineSummary) {
      return 'No se ha podido conectar con la API ni validar con el listado local.';
    }

    if (error && typeof error === 'object') {
      const candidate = error as { error?: { error?: { message?: unknown }; message?: unknown }; message?: unknown };
      const message = candidate.error?.error?.message ?? candidate.error?.message ?? candidate.message;
      if (typeof message === 'string' && message.trim()) {
        return message;
      }
    }

    return 'No se ha podido validar la entrada.';
  }

  private pickPreferredCamera(devices: MediaDeviceInfo[]): MediaDeviceInfo | undefined {
    if (!devices.length) {
      return undefined;
    }

    const rearCameras = devices.filter((device) => /back|rear|environment|trasera|posterior/i.test(device.label));
    const regularRearCamera = rearCameras.find((device) => !/ultra|wide|tele|macro|zoom/i.test(device.label));
    return regularRearCamera ?? rearCameras[0] ?? devices[devices.length - 1];
  }

  private inspectCameraCapabilities(): void {
    const track = this.getActiveVideoTrack();
    if (!track) {
      this.zoomSupported = false;
      return;
    }

    const capabilities = track.getCapabilities() as MediaTrackCapabilities & {
      zoom?: { min?: number; max?: number; step?: number };
    };

    if (!capabilities.zoom) {
      this.zoomSupported = false;
      return;
    }

    this.zoomSupported = true;
    this.zoomMin = Number(capabilities.zoom.min ?? 1);
    this.zoomMax = Number(capabilities.zoom.max ?? this.zoomMin);
    this.zoomStep = Number(capabilities.zoom.step ?? 0.1);

    const settings = track.getSettings() as MediaTrackSettings & { zoom?: number };
    this.zoomValue = Math.max(this.zoomMin, Math.min(this.zoomMax, Number(settings.zoom ?? this.zoomMin)));

    if (this.zoomValue > this.zoomMin) {
      this.zoomValue = this.zoomMin;
      this.applyZoom();
    }
  }

  private getActiveVideoTrack(): MediaStreamTrack | null {
    const video = this.scannerRoot?.nativeElement.querySelector('video');
    const stream = video?.srcObject instanceof MediaStream ? video.srcObject : null;
    return stream?.getVideoTracks()[0] ?? null;
  }

  private startValidationWatchdog(runId: number, code: string): void {
    this.clearValidationWatchdog();
    this.validationWatchdogId = window.setTimeout(() => {
      this.ngZone.run(() => {
        if (!this.loading || this.validationRun !== runId) {
          return;
        }

        this.loading = false;
        this.validationAttemptMessage = '';
        this.validationRun += 1;
        this.clearValidationWatchdog();
        this.addDebug(`native watchdog stopped loading after ${this.validationWatchdogMs()}ms`);
        this.result = {
          status: 'invalid',
          codigo: code,
          message: 'La validacion no ha devuelto resultado en el tiempo esperado. Revisa el log de debug.',
          ticket: null
        };
        this.changeDetectorRef.detectChanges();
      });
    }, this.validationWatchdogMs());
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
      this.loadOfflineZonesIfNeeded();
      return;
    }

    this.ticketsAdminService.listZones(this.year, this.eventId).subscribe({
      next: ({ data }) => {
        this.zones = data;
        this.changeDetectorRef.detectChanges();
      },
      error: () => this.loadOfflineZonesIfNeeded()
    });
  }

  private async validateOnlineWithRetries(code: string, zoneId: string | null): Promise<{ ok: boolean; data: TicketValidationResult }> {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= MAX_ONLINE_VALIDATION_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const abortId = window.setTimeout(() => controller.abort(), VALIDATION_ATTEMPT_TIMEOUT_MS);
      this.validationAttemptMessage = attempt === 1
        ? `Intento online ${attempt}/${MAX_ONLINE_VALIDATION_ATTEMPTS}`
        : `Reintentando validacion online ${attempt}/${MAX_ONLINE_VALIDATION_ATTEMPTS}`;
      if (attempt > 1) {
        this.networkMode = 'weak';
        this.addDebug(this.validationAttemptMessage);
        await this.delay(RETRY_PAUSE_MS);
      } else {
        this.addDebug(this.validationAttemptMessage);
      }

      try {
        return await this.ticketsAdminService.validateAsync(code, this.year, this.eventId, zoneId, controller.signal);
      } catch (error) {
        lastError = error;
        this.addDebug(`online attempt ${attempt} failed ${this.debugString(this.errorDebugInfo(error))}`);
      } finally {
        window.clearTimeout(abortId);
        this.changeDetectorRef.detectChanges();
      }
    }

    throw lastError ?? new Error('Online validation failed');
  }

  private async loadZonesForOfflineManifest(): Promise<TicketAccessZone[]> {
    if (this.accessZones.length || !this.eventId) {
      return this.accessZones;
    }

    const response = await firstValueFrom(this.ticketsAdminService.listZones(this.year, this.eventId));
    return response.data;
  }

  private async prepareOfflineModeLegacy(): Promise<void> {
    try {
      const tickets = await this.ticketsAdminService.listAllTickets(this.year, this.eventId);
      const zones = await this.loadZonesForOfflineManifest();
      this.offlineSummary = this.offlineValidationService.saveManifest(this.year, this.eventId, tickets, zones);
      if (!this.accessZones.length && zones.length) {
        this.zones = zones;
      }
      this.addDebug(`offline legacy manifest ready tickets=${tickets.length} zones=${zones.length}`);
    } catch (error) {
      this.addDebug(`offline legacy manifest error ${this.debugString(this.errorDebugInfo(error))}`);
      this.result = {
        status: 'invalid',
        codigo: '',
        message: 'No se ha podido preparar el modo bajisima cobertura.',
        ticket: null
      };
    }
  }

  private async syncOfflinePendingLegacy(): Promise<void> {
    try {
      const summary = await this.offlineValidationService.syncPendingLegacy(
        this.year,
        this.eventId,
        (codigo, zoneId) => this.validateOnlineWithRetries(codigo, zoneId)
      );
      this.refreshOfflineSummary();
      this.addDebug(`offline legacy sync done attempted=${summary.attempted} synced=${summary.synced} conflicts=${summary.conflicts} failed=${summary.failed}`);
      this.result = {
        status: summary.failed ? 'invalid' : 'valid',
        codigo: '',
        message: `Sincronizacion: ${summary.synced} enviadas, ${summary.conflicts} conflictos, ${summary.failed} pendientes.`,
        ticket: null
      };
    } catch (error) {
      this.addDebug(`offline legacy sync error ${this.debugString(this.errorDebugInfo(error))}`);
      this.result = {
        status: 'invalid',
        codigo: '',
        message: 'No se han podido sincronizar las validaciones pendientes.',
        ticket: null
      };
    }
  }

  private loadOfflineZonesIfNeeded(): void {
    const offlineZones = this.offlineValidationService.zones(this.year, this.eventId);
    if (!this.accessZones.length && offlineZones.length) {
      this.zones = offlineZones;
      this.changeDetectorRef.detectChanges();
    }
  }

  private refreshOfflineSummary(): void {
    this.offlineSummary = this.offlineValidationService.summary(this.year, this.eventId);
  }

  private validationWatchdogMs(): number {
    return MAX_ONLINE_VALIDATION_ATTEMPTS * (VALIDATION_ATTEMPT_TIMEOUT_MS + RETRY_PAUSE_MS) + 1000;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
}
