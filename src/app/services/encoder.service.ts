import { Injectable } from '@angular/core';
import * as CryptoJS from 'crypto-js';

@Injectable({ providedIn: 'root' })
export class EncoderService {
  private readonly key = 'eFfFsJ2023*';
  private readonly iv = CryptoJS.enc.Utf8.parse('1234567890123456');

  encrypt(value: string): string {
    return CryptoJS.AES.encrypt(value, this.key, { iv: this.iv }).toString();
  }

  decrypt(value: string): string {
    return CryptoJS.AES.decrypt(value, this.key, { iv: this.iv }).toString(CryptoJS.enc.Utf8);
  }
}
