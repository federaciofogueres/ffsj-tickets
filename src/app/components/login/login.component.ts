import { ChangeDetectorRef, Component, NgZone, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly ngZone = inject(NgZone);

  username = new FormControl('');
  password = new FormControl('');
  error = '';
  feedback = '';
  loading = false;

  async login(): Promise<void> {
    if (this.loading) {
      return;
    }

    this.setState({ loading: true, error: '', feedback: 'Validando credenciales...' });
    const watchdog = window.setTimeout(() => {
      if (this.loading) {
        this.setState({
          loading: false,
          feedback: '',
          error: 'No se ha podido comprobar el acceso. Intentalo de nuevo.'
        });
      }
    }, 10000);

    try {
      if (!this.username.value || !this.password.value) {
        this.setState({ error: 'Introduce usuario y contrasena.' });
        return;
      }

      const result = await this.authService.login(this.username.value!, this.password.value!);
      if (result === 'ok') {
        this.setState({ feedback: 'Bienvenido.' });
        void this.router.navigate(['/backoffice']);
      } else if (result === 'not-admin') {
        this.setState({ feedback: '', error: 'No tienes permisos de administrador para acceder a esta aplicacion.' });
      } else {
        this.setState({ feedback: '', error: 'Datos incorrectos de inicio de sesion.' });
      }
    } catch {
      this.setState({ feedback: '', error: 'No se ha podido comprobar el acceso. Intentalo de nuevo.' });
    } finally {
      window.clearTimeout(watchdog);
      this.setState({ loading: false });
    }
  }

  private setState(state: Partial<Pick<LoginComponent, 'loading' | 'error' | 'feedback'>>): void {
    this.ngZone.run(() => {
      Object.assign(this, state);
      this.changeDetectorRef.detectChanges();
    });
  }
}
