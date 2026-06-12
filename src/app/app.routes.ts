import { Routes } from '@angular/router';

import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: 'tickets/:accessCode', loadComponent: () => import('./components/public-ticket/public-ticket.component').then((m) => m.PublicTicketComponent) },
  { path: 'login', loadComponent: () => import('./components/login/login.component').then((m) => m.LoginComponent) },
  { path: 'validar', loadComponent: () => import('./components/validar/validar.component').then((m) => m.ValidarComponent), canActivate: [authGuard] },
  { path: 'backoffice/tracking/:id', loadComponent: () => import('./components/tracking-detail/tracking-detail.component').then((m) => m.TrackingDetailComponent), canActivate: [authGuard] },
  { path: 'backoffice', loadComponent: () => import('./components/backoffice/backoffice.component').then((m) => m.BackofficeComponent), canActivate: [authGuard] },
  { path: '', redirectTo: 'backoffice', pathMatch: 'full' },
  { path: '**', redirectTo: 'backoffice' }
];
