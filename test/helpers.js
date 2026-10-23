import { readFileSync } from "node:fs";

export function fixture(name) {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
}

// Builds a fetch stand-in from a route table. Each route is matched by URL
// prefix and returns JSON data, an HTTP status number, or an Error to throw.
// Every requested URL is recorded in `fetch.calls`.
export function fakeFetch(routes) {
  const calls = [];
  async function fetchImpl(url) {
    calls.push(url);
    const match = Object.keys(routes)
      .filter((prefix) => url.startsWith(prefix))
      .sort((a, b) => b.length - a.length)[0];
    if (match === undefined) {
      throw new TypeError(`Failed to fetch ${url}`);
    }
    const route = typeof routes[match] === "function" ? routes[match](url) : routes[match];
    if (route instanceof Error) {
      throw route;
    }
    if (typeof route === "number") {
      return { ok: false, status: route, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => structuredClone(route) };
  }
  fetchImpl.calls = calls;
  return fetchImpl;
}
