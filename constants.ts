
// The address of your Tor hidden service backend or local Flask server.
// For local testing with the provided Python backend, use http://127.0.0.1:5000
export const API_URL = "http://127.0.0.1:5000"; 

// How often to check for new messages, in milliseconds.
export const POLLING_INTERVAL = 3000; // 3 seconds

// Time in seconds after which a message disappears from the UI.
// Set to 0 to disable self-destruct.
// System and Error messages do not self-destruct.
export const SELF_DESTRUCT_SECONDS = 60; // 60 seconds
