import { gql, GraphQLClient } from "graphql-request";
import { DiffCapturedEvent } from "../../../common/src/events/events";
import { ACCESS_TOKEN, ANON_USER_ID, CLIENT_ID, DeviceStorageService, USER } from "../store";

const CAPTURE_DIFF_MUTATION = gql`
  mutation CaptureDiff($data: DiffCapturedEventInput!) {
    captureDiff(data: $data)
  }
`;

export class GraphQLAPI {
  private client: GraphQLClient;
  constructor(url: string, private readonly deviceStorage: DeviceStorageService) {
    this.client = new GraphQLClient(url);

    // Set inital header values in client
    this.updateToken();
    this.updateClientID();
    this.updateUserID();

    // Listen for changes and update header values on change
    deviceStorage.watchValue(ACCESS_TOKEN, this.updateToken.bind(this));
    deviceStorage.watchValue(CLIENT_ID, this.updateClientID.bind(this));
    deviceStorage.watchValue(USER, this.updateUserID.bind(this));
    deviceStorage.watchValue(ANON_USER_ID, this.updateUserID.bind(this));
  }

  async captureDiff(data: DiffCapturedEvent): Promise<boolean> {
    try {
      await this.client.request(CAPTURE_DIFF_MUTATION, { data });
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  private async updateClientID() {
    const clientID = this.deviceStorage.getClientID();
    this.client.setHeader("clientid", clientID ?? "");
  }

  private updateToken() {
    const accessToken = this.deviceStorage.getAccessToken();
    if (!accessToken) {
      this.client.setHeader("Authorization", ``);
      return;
    }

    this.client.setHeader("Authorization", `Bearer ${accessToken}`);
  }

  private updateUserID() {
    const userID = this.deviceStorage.getUser()?.id ?? this.deviceStorage.getAnonymousUserID();
    this.client.setHeader("userid", userID ?? "");
  }
}
