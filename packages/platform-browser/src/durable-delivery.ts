import { DeliveryStore } from "@sidecut/core/delivery-store";
import { DurableStorage } from "./sqlite-client";
export const openDeliveries = async () => new DeliveryStore(await DurableStorage.open());
