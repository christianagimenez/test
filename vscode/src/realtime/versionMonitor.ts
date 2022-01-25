import type firebase from "firebase/app";
import "firebase/database";

export interface IVersionChecker {
  isGTEMinimumVersion(version: string | undefined): boolean;
  readonly minimumVersion: string;
}

export class FirebaseVersionMonitor implements IVersionChecker {
  private minVersion: Version = new Version("0.0.0");

  constructor(private readonly db: firebase.database.Database) {
    db.ref("status/vscode/minVersion").on("value", (minVersionSnapshot) => {
      const minVersion = new Version(minVersionSnapshot.val());
      this.minVersion = minVersion;
    });
  }

  get minimumVersion(): string {
    return this.minVersion.toString();
  }

  isGTEMinimumVersion(version: string | undefined): boolean {
    if (version === undefined) {
      return false;
    }

    const compareVersion = new Version(version);
    return compareVersion.isGreaterThanOrEqualTo(this.minVersion);
  }
}

const VERSION_COMPARE_OPTS = { sensitivity: "base", numeric: true };

class Version {
  constructor(private readonly ver: string) {}

  isGreaterThanOrEqualTo(version: Version): boolean {
    return this.ver.localeCompare(version.ver, undefined, VERSION_COMPARE_OPTS) >= 0;
  }

  toString(): string {
    return this.ver;
  }
}
