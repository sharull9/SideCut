import { createFileRoute } from "@tanstack/react-router";
import { CloudUpcomingPage } from "@/modules/cloud/cloud-lazy";

export const Route = createFileRoute("/cloud/reviews")({ component: CloudReviews });

function CloudReviews() {
  return <CloudUpcomingPage section="reviews" />;
}
