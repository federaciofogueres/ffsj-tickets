import { Component, inject } from '@angular/core';
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

  username = new FormControl('');
  password = new FormControl('');
  error = '';
  loading = false;

  async login(): Promise<void> {
    this.loading = true;
    this.error = '';

    if (this.username.valid && this.password.valid) {
      if (await this.authService.login(this.username.value!, this.password.value!)) {
        this.loading = false;
        void this.router.navigate(['/backoffice']);
      } else {
        this.loading = false;
        this.error = 'Datos incorrectos de inicio de sesion.';
      }
    }
  }
}
