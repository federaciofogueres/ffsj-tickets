import { Injectable } from '@angular/core';

import { ApiResponse, Ticket, TicketAccessZone, TicketValidationResult } from '../models/ticket.model';

interface OfflineManifest {
  key: string;
  year: string;
  eventId: string | null;
  downloadedAt: string;
  tickets: Ticket[];
  zones: TicketAccessZone[];
}

interface PendingValidation {
  id: string;
  key: string;
  year: string;
  eventId: string | null;
  codigo: string;
  zoneId: string | null;
  createdAt: string;
  summaryType: 'ticket' | 'batch';
}

export interface OfflineManifestSummary {
  downloadedAt: string;
  total: number;
  locallyValidated: number;
  pending: number;
  zones: number;
}

export interface OfflineValidationOutcome {
  result: TicketValidationResult;
  queued: boolean;
  source: 'local' | 'none';
}

export interface OfflineSyncSummary {
  attempted: number;
  synced: number;
  conflicts: number;
  failed: number;
}

@Injectable({ providedIn: 'root' })
export class OfflineValidationService {
  private readonly manifestPrefix = 'ffsj-offline-manifest:';
  private readonly pendingKey = 'ffsj-offline-pending';

  saveManifest(year: string, eventId: string | null, tickets: Ticket[], zones: TicketAccessZone[]): OfflineManifestSummary {
    const key = this.manifestKey(year, eventId);
    const manifest: OfflineManifest = {
      key,
      year,
      eventId,
      downloadedAt: new Date().toISOString(),
      tickets: tickets.map((ticket) => ({ ...ticket })),
      zones: zones.map((zone) => ({ ...zone }))
    };

    localStorage.setItem(this.manifestStorageKey(key), JSON.stringify(manifest));
    return this.summary(year, eventId) ?? {
      downloadedAt: manifest.downloadedAt,
      total: tickets.length,
      locallyValidated: tickets.filter((ticket) => ticket.usada).length,
      pending: this.pendingForKey(key).length,
      zones: zones.length
    };
  }

  summary(year: string, eventId: string | null): OfflineManifestSummary | null {
    const manifest = this.getManifest(year, eventId);
    if (!manifest) {
      return null;
    }

    return {
      downloadedAt: manifest.downloadedAt,
      total: manifest.tickets.length,
      locallyValidated: manifest.tickets.filter((ticket) => ticket.usada).length,
      pending: this.pendingForKey(manifest.key).length,
      zones: manifest.zones.length
    };
  }

  pendingCount(year: string, eventId: string | null): number {
    return this.pendingForKey(this.manifestKey(year, eventId)).length;
  }

  zones(year: string, eventId: string | null): TicketAccessZone[] {
    return this.getManifest(year, eventId)?.zones.map((zone) => ({ ...zone })) ?? [];
  }

  validateLocal(code: string, year: string, eventId: string | null, zoneId: string | null): OfflineValidationOutcome {
    const manifest = this.getManifest(year, eventId);
    if (!manifest) {
      return {
        source: 'none',
        queued: false,
        result: {
          status: 'invalid',
          codigo: code,
          message: 'No hay listado offline preparado para este evento.',
          ticket: null
        }
      };
    }

    const normalizedCode = code.trim().toUpperCase();
    const ticketIndex = manifest.tickets.findIndex((ticket) => ticket.codigo.toUpperCase() === normalizedCode);
    if (ticketIndex >= 0) {
      return this.validateSingleTicket(manifest, ticketIndex, normalizedCode, zoneId);
    }

    const batchIndexes = manifest.tickets
      .map((ticket, index) => ({ ticket, index }))
      .filter(({ ticket }) => ticket.batchId?.toUpperCase() === normalizedCode)
      .map(({ index }) => index);

    if (batchIndexes.length) {
      return this.validateBatch(manifest, batchIndexes, normalizedCode, zoneId);
    }

    return {
      source: 'local',
      queued: false,
      result: {
        status: 'invalid',
        codigo: normalizedCode,
        message: 'Entrada no encontrada en el listado offline.',
        ticket: null
      }
    };
  }

  markServerValidation(year: string, eventId: string | null, result: TicketValidationResult): void {
    const manifest = this.getManifest(year, eventId);
    if (!manifest || result.status !== 'valid') {
      return;
    }

    const now = result.summary?.validatedAt ?? result.ticket?.validatedAt ?? result.ticket?.usadaAt ?? new Date().toISOString();
    if (result.summary?.type === 'batch') {
      manifest.tickets = manifest.tickets.map((ticket) => ticket.batchId === result.codigo ? this.markTicketUsed(ticket, now) : ticket);
    } else {
      manifest.tickets = manifest.tickets.map((ticket) => ticket.codigo === result.codigo ? this.markTicketUsed(ticket, now) : ticket);
    }
    this.saveRawManifest(manifest);
  }

  async syncPending(
    year: string,
    eventId: string | null,
    validate: (codigo: string, zoneId: string | null) => Promise<ApiResponse<TicketValidationResult>>
  ): Promise<OfflineSyncSummary> {
    const key = this.manifestKey(year, eventId);
    const pending = this.pendingForKey(key);
    const summary: OfflineSyncSummary = { attempted: pending.length, synced: 0, conflicts: 0, failed: 0 };

    for (const item of pending) {
      try {
        const response = await validate(item.codigo, item.zoneId);
        if (response.data.status === 'valid') {
          this.removePending(item.id);
          this.markServerValidation(year, eventId, response.data);
          summary.synced += 1;
        } else {
          this.removePending(item.id);
          summary.conflicts += 1;
        }
      } catch {
        summary.failed += 1;
      }
    }

    return summary;
  }

  private validateSingleTicket(manifest: OfflineManifest, ticketIndex: number, code: string, zoneId: string | null): OfflineValidationOutcome {
    const ticket = manifest.tickets[ticketIndex];
    const baseResult = this.ticketRejection(ticket, code, zoneId);
    if (baseResult) {
      return { source: 'local', queued: false, result: baseResult };
    }

    const validatedAt = new Date().toISOString();
    const updatedTicket = this.markTicketUsed(ticket, validatedAt);
    manifest.tickets[ticketIndex] = updatedTicket;
    this.saveRawManifest(manifest);
    this.addPending({
      key: manifest.key,
      year: manifest.year,
      eventId: manifest.eventId,
      codigo: code,
      zoneId,
      summaryType: 'ticket'
    });

    return {
      source: 'local',
      queued: true,
      result: {
        status: 'valid',
        codigo: code,
        message: 'Entrada validada en modo bajisima cobertura. Pendiente de sincronizar.',
        ticket: updatedTicket
      }
    };
  }

  private validateBatch(manifest: OfflineManifest, indexes: number[], code: string, zoneId: string | null): OfflineValidationOutcome {
    const tickets = indexes.map((index) => manifest.tickets[index]);
    const wrongZone = tickets.some((ticket) => zoneId && ticket.zoneId && ticket.zoneId !== zoneId);
    if (wrongZone) {
      return {
        source: 'local',
        queued: false,
        result: { status: 'wrong_zone', codigo: code, message: 'Lote no valido para esta zona de acceso.', ticket: null }
      };
    }

    const activeTickets = tickets.filter((ticket) => ticket.activada && !ticket.bloqueada);
    const alreadyValidated = activeTickets.filter((ticket) => ticket.usada).length;
    const candidates = activeTickets.filter((ticket) => !ticket.usada);
    if (!candidates.length) {
      return {
        source: 'local',
        queued: false,
        result: {
          status: 'used',
          codigo: code,
          message: 'Lote ya validado en el listado offline.',
          ticket: null,
          summary: this.batchSummary('batch', tickets.length, 0, alreadyValidated, activeTickets[0]?.validatedAt ?? null, tickets)
        }
      };
    }

    const validatedAt = new Date().toISOString();
    indexes.forEach((index) => {
      const ticket = manifest.tickets[index];
      if (ticket.activada && !ticket.bloqueada && !ticket.usada) {
        manifest.tickets[index] = this.markTicketUsed(ticket, validatedAt);
      }
    });
    this.saveRawManifest(manifest);
    this.addPending({
      key: manifest.key,
      year: manifest.year,
      eventId: manifest.eventId,
      codigo: code,
      zoneId,
      summaryType: 'batch'
    });

    return {
      source: 'local',
      queued: true,
      result: {
        status: 'valid',
        codigo: code,
        message: 'Lote validado en modo bajisima cobertura. Pendiente de sincronizar.',
        ticket: null,
        summary: this.batchSummary('batch', tickets.length, candidates.length, alreadyValidated, validatedAt, tickets)
      }
    };
  }

  private ticketRejection(ticket: Ticket, code: string, zoneId: string | null): TicketValidationResult | null {
    if (zoneId && ticket.zoneId && ticket.zoneId !== zoneId) {
      return { status: 'wrong_zone', codigo: code, message: 'Entrada no valida para esta zona de acceso.', ticket };
    }
    if (ticket.usada) {
      return { status: 'used', codigo: code, message: 'Entrada ya validada en el listado offline.', ticket };
    }
    if (ticket.bloqueada) {
      return { status: 'blocked', codigo: code, message: 'Entrada bloqueada.', ticket };
    }
    if (!ticket.activada) {
      return { status: 'inactive', codigo: code, message: 'Entrada no activada.', ticket };
    }

    return null;
  }

  private batchSummary(
    type: 'batch',
    total: number,
    validatedNow: number,
    alreadyValidated: number,
    validatedAt: string | null,
    tickets: Ticket[]
  ): TicketValidationResult['summary'] {
    return {
      type,
      total,
      validatedNow,
      alreadyValidated,
      inactive: tickets.filter((ticket) => !ticket.activada).length,
      blocked: tickets.filter((ticket) => ticket.bloqueada).length,
      validatedAt
    };
  }

  private markTicketUsed(ticket: Ticket, validatedAt: string): Ticket {
    return {
      ...ticket,
      usada: true,
      usadaAt: ticket.usadaAt ?? validatedAt,
      validatedAt: ticket.validatedAt ?? validatedAt
    };
  }

  private addPending(value: Omit<PendingValidation, 'id' | 'createdAt'>): void {
    const pending = this.getPending();
    pending.push({
      ...value,
      id: `${value.key}:${value.codigo}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      createdAt: new Date().toISOString()
    });
    localStorage.setItem(this.pendingKey, JSON.stringify(pending));
  }

  private removePending(id: string): void {
    localStorage.setItem(this.pendingKey, JSON.stringify(this.getPending().filter((item) => item.id !== id)));
  }

  private pendingForKey(key: string): PendingValidation[] {
    return this.getPending().filter((item) => item.key === key);
  }

  private getPending(): PendingValidation[] {
    return this.parseJson<PendingValidation[]>(localStorage.getItem(this.pendingKey), []);
  }

  private getManifest(year: string, eventId: string | null): OfflineManifest | null {
    return this.parseJson<OfflineManifest | null>(localStorage.getItem(this.manifestStorageKey(this.manifestKey(year, eventId))), null);
  }

  private saveRawManifest(manifest: OfflineManifest): void {
    localStorage.setItem(this.manifestStorageKey(manifest.key), JSON.stringify(manifest));
  }

  private manifestKey(year: string, eventId: string | null): string {
    return `${year}:${eventId || 'global'}`;
  }

  private manifestStorageKey(key: string): string {
    return `${this.manifestPrefix}${key}`;
  }

  private parseJson<T>(value: string | null, fallback: T): T {
    if (!value) {
      return fallback;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
}
