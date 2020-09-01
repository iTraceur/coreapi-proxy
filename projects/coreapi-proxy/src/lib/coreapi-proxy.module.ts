import { NgModule } from '@angular/core';
import { ConfigService } from './config.service';
import { GlobalState } from './global.state';
import { CoreAPIClient, CoreAPIBaseService, coreAPIFactory } from './coreapi-proxy.service';



@NgModule({
  declarations: [
  ],
  imports: [
  ],
  providers: [
    ConfigService,
    GlobalState,
    CoreAPIBaseService,
    {
      provide: CoreAPIClient,
      useFactory: coreAPIFactory,
      deps: [ConfigService, GlobalState],
    }
  ],
  exports: [
  ]
})
export class CoreAPIProxyModule { }
