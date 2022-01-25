import mixpanel from "mixpanel";
import { EnvironmentVariables, inferEnvironment } from "../../../common/src/env/env";
import type { User } from "../../../common/src/model/auth";
import { UserID } from "../../../common/src/model/notebook-dom";
import type { TrackerEvent } from "../../../common/src/tracking/events";
import type { IEventTracker, TrackerProperties } from "../../../common/src/tracking/interface";

/**********************************************************************************
 * THIS FILE IS CURRENTLY DUPLICATED IN THE FUNCTIONS PROJECT AS src/tracking/... *
 **********************************************************************************/

export class MixpanelNodeJSEventTracker implements IEventTracker {
  private cachedMixpanel: any | undefined;

  constructor(private readonly env?: EnvironmentVariables) {}

  private get mixpanel(): mixpanel.Mixpanel {
    if (!this.cachedMixpanel) {
      const key = getAPIKey(this.env);
      this.cachedMixpanel = mixpanel.init(key, { protocol: "https" });
    }

    return this.cachedMixpanel;
  }

  identify(user: User): void {
    try {
      this.mixpanel.people.set(user.id, { $email: user.email, $name: user.displayName });
    } catch (e: any) {
      console.error("identify: failed to set user", e);
    }
  }

  alias(userID: UserID, anyID: string) {
    try {
      this.mixpanel.alias(userID, anyID);
    } catch (e: any) {
      console.error(`alias: failed to alias ${userID} to ${anyID}`, e);
    }
  }

  // If useTempDistinctID option is set, this function will return the temp distinct_id
  track(event: TrackerEvent, properties?: TrackerProperties): string | void {
    if (!event) {
      return;
    }

    try {
      console.log(`track: received event ${event}`);
      const allProperties = {
        distinct_id: event.userID ?? "unknown",
        ...event.toData(),
        ...properties,
      };
      this.mixpanel.track(event.type, allProperties);
    } catch (e: any) {
      console.error(
        `track: failed to track ${event} for user ${event.userID} (pb: ${event.notebookID})`,
        e
      );
    }
  }
}

function getAPIKey(explicitEnv?: EnvironmentVariables): string {
  const env = explicitEnv ?? inferEnvironment();
  return env.MIXPANEL_KEY;
}
