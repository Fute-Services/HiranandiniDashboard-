/**
 * Client-side session flag. There's no auth backend yet, so "signed in" is just
 * a cookie the login page sets and the middleware checks — enough to gate the
 * UI. Replace with a real, server-verified session when a backend lands.
 */
export const AUTH_COOKIE = "hiranandani_auth";
export const AUTH_MAX_AGE = 60 * 60 * 24 * 7; // 7 days, in seconds
export const LOGIN_PATH = "/login";

/**
 * The one hardcoded account, for now. This is placeholder access, not real
 * auth: the check runs in the browser, so anyone reading the bundle can see
 * these. Move to a server-verified credential when a backend lands.
 */
export const DEMO_EMAIL = "hiranandani@gmail.com";
export const DEMO_PASSWORD = "hiranandani123";
