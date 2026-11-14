import { lazy } from "react";

// The cloud dashboard and its CSS load only when a /cloud page is opened.
const dashboard = () => import("./cloud-dashboard");

export const CloudLayout = lazy(() => dashboard().then((m) => ({ default: m.CloudLayout })));
export const CloudOverviewPage = lazy(() =>
  dashboard().then((m) => ({ default: m.CloudOverviewPage })),
);
export const CloudConnectedPage = lazy(() =>
  dashboard().then((m) => ({ default: m.CloudConnectedPage })),
);
export const CloudUpcomingPage = lazy(() =>
  dashboard().then((m) => ({ default: m.CloudUpcomingPage })),
);
