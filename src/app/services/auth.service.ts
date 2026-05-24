import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CookieService } from 'ngx-cookie-service';
import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { ResponseToken } from '../../external-api/responseToken';
import { Usuario } from '../../external-api/usuario';
import { CensoService } from './censo.service';
import { EncoderService } from './encoder.service';

export type LoginResult = 'ok' | 'invalid' | 'not-admin';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly router = inject(Router);
  private readonly censoService = inject(CensoService);
  private readonly encoderService = inject(EncoderService);
  private readonly cookieService = inject(CookieService);
  private readonly tokenKey = 'token';
  private readonly loggedInSubject = new BehaviorSubject<boolean>(this.isLoggedIn());
  readonly loggedIn$ = this.loggedInSubject.asObservable();

  getToken(): string {
    const encryptedToken = this.cookieService.get(this.tokenKey);
    return encryptedToken ? this.encoderService.decrypt(encryptedToken) : '';
  }

  saveToken(token: string): void {
    this.cookieService.set(this.tokenKey, this.encoderService.encrypt(token.trim()), {
      sameSite: 'Lax',
      path: '/'
    });
    this.loggedInSubject.next(true);
  }

  async login(user: string, password: string): Promise<LoginResult> {
    const usuario: Usuario = {
      user,
      password: this.encoderService.encrypt(password)
    };

    const response = await firstValueFrom(
      this.censoService.doLogin(usuario).pipe(
        timeout(12000),
        catchError(() => of(null))
      )
    );

    const token = (response as ResponseToken | null)?.token;
    if (!token) {
      return 'invalid';
    }

    const tokenValue = String(token);
    if (await this.isAdminToken(tokenValue)) {
      this.saveToken(tokenValue);
      this.censoService.configuration.accessToken = tokenValue;
      return 'ok';
    }

    this.clearToken();
    return 'not-admin';
  }

  async ensureAdmin(): Promise<boolean> {
    const token = this.getToken();
    if (!token || !this.isLoggedIn()) {
      this.clearToken();
      return false;
    }

    if (await this.isAdminToken(token)) {
      this.censoService.configuration.accessToken = token;
      return true;
    }

    this.clearToken();
    return false;
  }

  logout(): void {
    this.clearToken();
    void this.router.navigate(['/login']);
  }

  isLoggedIn(): boolean {
    const token = this.getToken();
    if (!token) {
      return false;
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      return true;
    }

    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
      return !payload.exp || Math.floor(Date.now() / 1000) < payload.exp;
    } catch {
      return false;
    }
  }

  private async isAdminToken(token: string): Promise<boolean> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (environment.adminApiKey) {
      headers['x-admin-key'] = environment.adminApiKey;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${environment.adminApiBaseUrl}/me`, {
        headers,
        signal: controller.signal
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  private clearToken(): void {
    this.cookieService.delete(this.tokenKey, '/');
    this.loggedInSubject.next(false);
  }
}
