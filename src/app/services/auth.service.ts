import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CookieService } from 'ngx-cookie-service';
import { BehaviorSubject } from 'rxjs';

import { ResponseToken } from '../../external-api/responseToken';
import { Usuario } from '../../external-api/usuario';
import { CensoService } from './censo.service';
import { EncoderService } from './encoder.service';

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

  login(user: string, password: string): Promise<boolean> {
    const usuario: Usuario = {
      user,
      password: this.encoderService.encrypt(password)
    };

    return new Promise((resolve) => {
      this.censoService.doLogin(usuario).subscribe({
        next: (response: ResponseToken) => {
          if (response.token) {
            this.saveToken(String(response.token));
            this.censoService.configuration.accessToken = String(response.token);
            resolve(true);
          } else {
            resolve(false);
          }
        },
        error: () => resolve(false)
      });
    });
  }

  logout(): void {
    this.cookieService.delete(this.tokenKey, '/');
    this.loggedInSubject.next(false);
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
}
