import * as shortid from "shortid";
import { UniqueIDGenerator } from "../../../common/src/model/ids";

export const shortIDGenerator: UniqueIDGenerator = {
  nextID(): string {
    return shortid.generate();
  },
};
