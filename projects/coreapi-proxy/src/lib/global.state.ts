import { Injectable } from '@angular/core';
import { Subject } from 'rxjs/Subject';

@Injectable()
export class GlobalState {

  private data = new Subject<Object>();
  private dataStream$ = this.data.asObservable();

  private subscriptions: Map<string, Array<Function>> = new Map<string, Array<Function>>();

  constructor() {
    this.dataStream$.subscribe((data) => this.onEvent(data));
  }

  publish(event, value, force = false) {
    const current = this.data[event];
    if (current !== value || force) {
      this.data[event] = value;

      this.data.next({
        event: event,
        data: this.data[event],
      });
    }
  }

  subscribe(event: string, callback: Function) {
    const subscribers = this.subscriptions.get(event) || [];
    if (subscribers.indexOf(callback) < 0) {
      subscribers.push(callback);
    }
    this.subscriptions.set(event, subscribers);
  }

  onEvent(data: any) {
    const subscribers = this.subscriptions.get(data['event']) || [];
    subscribers.forEach((callback) => {
      callback.call(null, data['data']);
    });
  }
}
