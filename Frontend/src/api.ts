// The backend runs on port 4000 of whichever host served the frontend,
// so the app works when opened from another machine on the network.
//
export const apiUrl = (path: string = ""): string => `${window.location.protocol}//${window.location.hostname}:4000${path}`;
