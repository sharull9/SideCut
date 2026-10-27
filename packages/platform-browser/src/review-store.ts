import { ReviewStore as CoreReviewStore } from "@sidecut/core/review-library";
import { DurableStorage } from "./sqlite-client";

export class ReviewStore extends CoreReviewStore {
  static async open(): Promise<ReviewStore> {
    return new ReviewStore(await DurableStorage.open());
  }
}
