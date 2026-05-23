import { Routes } from '@angular/router';

import { BackofficeComponent } from './components/backoffice/backoffice.component';
import { LoginComponent } from './components/login/login.component';
import { ValidarComponent } from './components/validar/validar.component';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'validar', component: ValidarComponent, canActivate: [authGuard] },
  { path: 'backoffice', component: BackofficeComponent, canActivate: [authGuard] },
  { path: '', redirectTo: 'backoffice', pathMatch: 'full' },
  { path: '**', redirectTo: 'backoffice' }
];
