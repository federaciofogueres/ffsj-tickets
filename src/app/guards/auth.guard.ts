import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth.service';
import { CensoService } from '../services/censo.service';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const censoService = inject(CensoService);
  const router = inject(Router);

  if (authService.isLoggedIn()) {
    censoService.configuration.accessToken = authService.getToken();
    return true;
  }

  return router.createUrlTree(['/login']);
};
