// Base URL of the backend, as seen from the browser.
//
// These calls run in the visitor's browser, so a hardcoded "localhost" points
// at the visitor's own machine, not at the server. Default to the host the page
// was served from, which works for localhost and for any other machine on the
// network without configuration. Set NEXT_PUBLIC_API_URL to override (e.g. when
// the backend sits behind a different host or a reverse proxy).
const API_PORT = process.env.NEXT_PUBLIC_API_PORT ?? "4000";

export function apiBaseUrl(): string {
    const configured = process.env.NEXT_PUBLIC_API_URL;

    if (configured) {
        return configured.replace(/\/$/, "");
    }

    if (typeof window === "undefined") {
        // Rendered on the server; the browser re-evaluates this on hydration.
        return `http://localhost:${API_PORT}`;
    }

    return `${window.location.protocol}//${window.location.hostname}:${API_PORT}`;
}

// Build a backend URL, e.g. apiUrl("/devices") or apiUrl(`/devices/${id}`).
export function apiUrl(path: string = ""): string {
    return `${apiBaseUrl()}${path}`;
}
