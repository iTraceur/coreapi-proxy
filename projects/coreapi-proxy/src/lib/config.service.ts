import { Injectable } from '@angular/core';

@Injectable()
export class ConfigService {
  private data: Object = null;

  set(data) {
    this.data = data;
  }

  get(key: any) {
    return this.data[key];
  }
}
