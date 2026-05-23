import { HttpClient, HttpEvent, HttpHeaders, HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { Configuration } from '../../external-api/configuration';
import { ResponseAsociaciones } from '../../external-api/responseAsociaciones';
import { ResponseToken } from '../../external-api/responseToken';
import { Usuario } from '../../external-api/usuario';

@Injectable({ providedIn: 'root' })
export class CensoService {
  protected basePath = 'https://censo-api.hogueras.es/emjf1/Censo-Hogueras/1.0.0';
  public defaultHeaders = new HttpHeaders();
  public configuration = new Configuration();

  constructor(private readonly httpClient: HttpClient) {}

  public asociacionesGet(observe?: 'body', reportProgress?: boolean): Observable<ResponseAsociaciones>;
  public asociacionesGet(observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<ResponseAsociaciones>>;
  public asociacionesGet(observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<ResponseAsociaciones>>;
  public asociacionesGet(observe: any = 'body', reportProgress = false): Observable<any> {
    let headers = this.defaultHeaders;
    if (this.configuration.accessToken) {
      const accessToken = typeof this.configuration.accessToken === 'function'
        ? this.configuration.accessToken()
        : this.configuration.accessToken;
      headers = headers.set('Authorization', `Bearer ${accessToken}`);
    }
    const accept = this.configuration.selectHeaderAccept(['application/json']);
    if (accept) {
      headers = headers.set('Accept', accept);
    }

    return this.httpClient.request<ResponseAsociaciones>('get', `${this.basePath}/asociaciones`, {
      withCredentials: this.configuration.withCredentials,
      headers,
      observe,
      reportProgress
    });
  }

  public doLogin(body: Usuario, observe?: 'body', reportProgress?: boolean): Observable<ResponseToken>;
  public doLogin(body: Usuario, observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<ResponseToken>>;
  public doLogin(body: Usuario, observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<ResponseToken>>;
  public doLogin(body: Usuario, observe: any = 'body', reportProgress = false): Observable<any> {
    let headers = this.defaultHeaders;
    const accept = this.configuration.selectHeaderAccept(['application/json']);
    const contentType = this.configuration.selectHeaderContentType(['application/json']);
    if (accept) {
      headers = headers.set('Accept', accept);
    }
    if (contentType) {
      headers = headers.set('Content-Type', contentType);
    }

    return this.httpClient.request<ResponseToken>('post', `${this.basePath}/login`, {
      body,
      withCredentials: this.configuration.withCredentials,
      headers,
      observe,
      reportProgress
    });
  }
}
