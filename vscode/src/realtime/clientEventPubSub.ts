import "firebase/database";
import { ClientEvent } from "../../../common/src/events/events";
import { SubscriptionBase } from "../../../common/src/events/pubSub";
import type { ClientID } from "../../../common/src/model/notebook-dom";
import {
  IRealtimeDB,
  IRealtimeDBSnapshot,
  WatchDisposer,
} from "../../../common/src/persistence/IRealtimeDB";
import { makeClientEventListenerPath } from "../../../common/src/schema";

/** FirebaseEventStream marshals from Firebase to one or more handlers */

type ClientSubscriberFn<T extends ClientEvent> = (event: T) => any;
type ClientEventTypes = ClientEvent["type"];

export interface IClientEventPubSub {
  subscribe<T extends ClientEvent>(eventType: ClientEventTypes, subFn: ClientSubscriberFn<T>): void;
  dispose(): void;
}

export class FirebaseClientEventPubSub
  extends SubscriptionBase<ClientEvent>
  implements IClientEventPubSub
{
  private readonly watchDisposer: WatchDisposer;

  constructor(private readonly clientID: ClientID, private readonly db: IRealtimeDB) {
    super();

    const path = makeClientEventListenerPath(this.clientID);
    const handler = this.handleEventAdded.bind(this);
    this.watchDisposer = this.db.watchAdded(path, handler);
  }

  dispose() {
    this.watchDisposer();
  }

  public subscribe<T extends ClientEvent>(
    eventType: T["type"],
    subFn: ClientSubscriberFn<T>
  ): void {
    const key = this.makeClientEventKey(eventType);
    this.subscriptions.add(key, subFn);
  }

  private handleEventAdded(snapshot: IRealtimeDBSnapshot) {
    const event: ClientEvent = snapshot.val();
    const key = this.makeClientEventKey(event.type);
    if (this.subscriptions.distribute(key, event)) {
      this.db.remove(snapshot.path);
    }
  }

  protected makeClientEventKey(eventType: ClientEventTypes): string {
    return `${this.clientID}:${eventType}`;
  }
}
