import { Injectable, Injector } from '@angular/core';
import { LocalStorageService } from 'angular-web-storage';
import { Promise } from 'bluebird';
import * as coreapi from 'coreapi';
import { Observable } from 'rxjs';

import { ConfigService } from "./config.service";
import { GlobalState } from './global.state';

export interface ActionParams {
  Params?: object,
  ExtraParams?: object
}

@Injectable()
export class CoreAPIBaseService {
  constructor(private client: CoreAPIClient) {
  }

  action(keys: Array<string>, params = {}, extraParams = {}) {
    const actionParams: ActionParams = { Params: params, ExtraParams: extraParams };
    return this.client.action(keys, actionParams);
  }
}

export interface ICoreAPIConfig {
  globalHeaders: Array<Object>;
  headerName: string;
  headerPrefix: string;
  noJwtError: boolean;
  noClientCheck: boolean;
  noTokenScheme?: boolean;
  tokenGetter: () => string | Promise<string>;
  tokenName: string;
}

export interface ICoreAPIConfigOptional {
  headerName?: string;
  headerPrefix?: string;
  tokenName?: string;
  tokenGetter?: () => string | Promise<string>;
  noJwtError?: boolean;
  noClientCheck?: boolean;
  globalHeaders?: Array<Object>;
  noTokenScheme?: boolean;
}

export class CoreAPIConfigConsts {
  public static DEFAULT_HEADER_NAME = 'Authorization';
  public static HEADER_PREFIX_BEARER = 'JWT';
  public static DEFAULT_TOKEN_NAME = 'token';
}

const COREAPI_CONFIG_DEFAULTS: ICoreAPIConfig = {
  headerName: CoreAPIConfigConsts.DEFAULT_HEADER_NAME,
  headerPrefix: null,
  tokenName: CoreAPIConfigConsts.DEFAULT_TOKEN_NAME,
  tokenGetter: () =>
    localStorage.getItem(COREAPI_CONFIG_DEFAULTS.tokenName) as string,
  noJwtError: false,
  noClientCheck: false,
  globalHeaders: [],
  noTokenScheme: false,
};

/**
 * Helper class to decode and find JWT expiration.
 */

export class JwtHelper {
  public urlBase64Decode(str: string): string {
    let output = str.replace(/-/g, '+').replace(/_/g, '/');
    switch (output.length % 4) {
      case 0: {
        break;
      }
      case 2: {
        output += '==';
        break;
      }
      case 3: {
        output += '=';
        break;
      }
      default: {
        throw new Error('Illegal base64url string!');
      }
    }
    return this.b64DecodeUnicode(output);
  }

  public decodeToken(token: string): any {
    const parts = token.split('.');

    if (parts.length !== 3) {
      throw new Error('JWT must have 3 parts');
    }

    const decoded = this.urlBase64Decode(parts[1]);
    if (!decoded) {
      throw new Error('Cannot decode the token');
    }

    return JSON.parse(decoded);
  }

  public getTokenExpirationDate(token: string): Date {
    let decoded: any;
    decoded = this.decodeToken(token);

    if (!decoded.hasOwnProperty('exp')) {
      return null;
    }

    const date = new Date(0); // The 0 here is the key, which sets the date to the epoch
    date.setUTCSeconds(decoded.exp);

    return date;
  }

  public isTokenExpired(token: string, offsetSeconds?: number): boolean {
    const date = this.getTokenExpirationDate(token);
    offsetSeconds = offsetSeconds || 0;

    if (date == null) {
      return false;
    }

    // Token expired?
    return !(date.valueOf() > new Date().valueOf() + offsetSeconds * 1000);
  }

  // credits for decoder goes to https://github.com/atk
  private b64decode(str: string): string {
    const chars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    let output = '';

    str = String(str).replace(/=+$/, '');

    if (str.length % 4 === 1) {
      throw new Error(
        '"atob" failed: The string to be decoded is not correctly encoded.',
      );
    }

    for (
      // initialize result and counters
      let bc = 0, bs: any, buffer: any, idx = 0;
      // get next character
      (buffer = str.charAt(idx++));
      // character found in table? initialize bit storage and add its ascii value;
      ~buffer &&
      ((bs = bc % 4 ? bs * 64 + buffer : buffer),
        // and if not first of each 4 characters,
        // convert the first 8 bits to one ascii character
      bc++ % 4)
        ? (output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6))))
        : 0
    ) {
      // try to find character in table (0-63, not found => -1)
      buffer = chars.indexOf(buffer);
    }
    return output;
  }

  // https://developer.mozilla.org/en/docs/Web/API/WindowBase64/Base64_encoding_and_decoding#The_Unicode_Problem
  private b64DecodeUnicode(str: any) {
    return decodeURIComponent(
      Array.prototype.map
        .call(this.b64decode(str), (c: any) => {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        })
        .join(''),
    );
  }
}

const injector = Injector.create({ providers: [{ provide: LocalStorageService }] });
const localStorageService = injector.get(LocalStorageService);

/**
 * Checks for presence of token and that token hasn't expired.
 * For use with the @CanActivate router decorator and NgIf
 */
export function tokenNotExpired(
  tokenName = CoreAPIConfigConsts.DEFAULT_TOKEN_NAME,
  jwt?: string,
): boolean {
  const token: string = jwt || localStorageService.get(tokenName);
  const jwtHelper = new JwtHelper();
  return token != null && !jwtHelper.isTokenExpired(token);
}

/**
 * Sets up the authentication configuration.
 */

export class CoreAPIConfig {
  _config: ICoreAPIConfig;

  constructor(config?: ICoreAPIConfigOptional) {
    config = config || {};
    this._config = objectAssign({}, COREAPI_CONFIG_DEFAULTS, config);
    if (this._config.headerPrefix) {
      this._config.headerPrefix += ' ';
    } else if (this._config.noTokenScheme) {
      this._config.headerPrefix = '';
    } else {
      this._config.headerPrefix = CoreAPIConfigConsts.HEADER_PREFIX_BEARER;
    }

    if (config.tokenName && !config.tokenGetter) {
      this._config.tokenGetter = () =>
        localStorage.getItem(config.tokenName) as string;
    }
  }

  public getConfig(): ICoreAPIConfig {
    return this._config;
  }
}

@Injectable()
export class CoreAPIClient {
  public tokenStream: Observable<string>;

  private coreAPIConfig: ICoreAPIConfig;
  private _client: any;
  private schema;
  private fetchingSchema = false;

  constructor(
    private options: CoreAPIConfig,
    private config: ConfigService,
    private globalState: GlobalState,
  ) {
    this.coreAPIConfig = options.getConfig();

    this.tokenStream = new Observable<string>((obs: any) => {
      obs.next(this.coreAPIConfig.tokenGetter());
    });
    this.globalState.subscribe('user.logout', logout => {
      this._client = null;
      this.schema = null;
    });
    this.globalState.subscribe('user.tokenRefreshed', () => {
      this._client = null;
    });
  }

  get(url: string) {
    return this.client.get(url);
  }

  sleep(ms) {
    return new Promise((resolve, reject) => setTimeout(resolve, ms));
  }

  async waitSchema() {
    for (let i = 0; i < 600; i++) {
      await this.sleep(100);
      if (this.schema) {
        return;
      }
    }
  }

  getSchema() {
    return new Promise((resolve, reject) => {
      if (!this.schema) {
        if (this.fetchingSchema) {
          this.waitSchema()
            .then(() => {
              resolve(this.schema);
            })
            .catch(error => {
              console.error(`Fetch schema timeout.`, error);
              reject(error);
            });
        } else {
          const url = this.config.get('schemaUrl');
          this.fetchingSchema = true;
          this.get(url)
            .then(data => {
              this.schema = data;
              resolve(this.schema);
              this.fetchingSchema = false;
            })
            .catch(error => {
              console.error(`Fetch schema failed.`, error);
              reject(error);
              this.fetchingSchema = false;
            });
        }
      } else {
        resolve(this.schema);
      }
    });
  }

  action(
    keys: Array<string>,
    params: ActionParams = {},
  ): Promise<any> {
    this.globalState.publish('http.loading', true);

    return new Promise((resolve, reject) => {
      this.getSchema()
        .then(doc => {
          this.client
            .action(doc, keys, params.Params, params.ExtraParams)
            .then(data => {
              this.globalState.publish('http.loading', false);
              resolve(data);
            })
            .catch(error => {
              console.error(error);

              let message = '';
              if (Object.prototype.toString.call(error.content) === '[object Object]') {  // Whether it is an Objec object
                message = error.content.detail;
              } else {
                message = error.content;
              }

              if (error.response.status === 401) {
                this.globalState.publish('http.401', message);
              } else if (error.response.status === 403) {
                this.globalState.publish('http.403', message, true);
              } else if (error.response.status === 500) {
                this.globalState.publish('http.500', message, true);
              } else if (error.response.status === 501) {
                this.globalState.publish('http.501', message, true);
              }

              this.globalState.publish('http.loading', false);
              reject(error);
            });
        })
        .catch(error => {
          console.error(`Request ${keys} failed.`, error);

          this.globalState.publish('http.loading', false);
          reject(error);
        });
    });
  }

  private get client() {
    if (!this._client) {
      const options = {
        auth: new coreapi.auth.TokenAuthentication({
          token: this.coreAPIConfig.tokenGetter(),
          scheme: this.coreAPIConfig.headerPrefix,
        }),
      };
      this._client = new coreapi.Client(options);
    }

    return this._client;
  }
}

export function coreAPIFactory(
  config: ConfigService,
  globalState: GlobalState,
) {
  const coreAPIConfig = {
    headerName: CoreAPIConfigConsts.DEFAULT_HEADER_NAME,
    headerPrefix: CoreAPIConfigConsts.HEADER_PREFIX_BEARER,
    tokenName: CoreAPIConfigConsts.DEFAULT_TOKEN_NAME,
    tokenGetter() {
      return localStorageService.get(coreAPIConfig.tokenName);
    },
    globalHeaders: [{ 'Content-Type': 'application/json' }],
    noJwtError: false,
    noTokenScheme: false,
  };
  return new CoreAPIClient(
    new CoreAPIConfig(coreAPIConfig),
    config,
    globalState,
  );
}

const hasOwnProperty = Object.prototype.hasOwnProperty;
const propIsEnumerable = Object.prototype.propertyIsEnumerable;

function toObject(val: any) {
  if (val === null || val === undefined) {
    throw new TypeError(
      'Object.assign cannot be called with null or undefined',
    );
  }

  return Object(val);
}

function objectAssign(target: any, ...source: any[]) {
  let from: any;
  let symbols: any;
  const to = toObject(target);

  for (let s = 1; s < arguments.length; s++) {
    from = Object(arguments[s]);

    for (const key in from) {
      if (hasOwnProperty.call(from, key)) {
        to[key] = from[key];
      }
    }

    if ((<any>Object).getOwnPropertySymbols) {
      symbols = (<any>Object).getOwnPropertySymbols(from);
      for (let i = 0; i < symbols.length; i++) {
        if (propIsEnumerable.call(from, symbols[i])) {
          to[symbols[i]] = from[symbols[i]];
        }
      }
    }
  }
  return to;
}

export class CoreAPIClientHttpError extends Error {
}
