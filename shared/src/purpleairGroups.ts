/**
 * PurpleAir API group/member management — mirrors AirSensor's `pa_*`
 * helpers. We don't open a live HTTP client here; instead this module
 * exposes typed adapter contracts and request builders. The Cloudflare
 * Worker (or a Node test harness) plugs in an HTTP fetcher.
 *
 * API reference: https://api.purpleair.com (v1).
 */

export type PurpleAirAuth = {
  readKey: string;
  writeKey?: string;
};

export type PurpleAirGroup = {
  id: number;
  name: string;
  createdEpoch?: number;
};

export type PurpleAirMember = {
  id: number;
  sensorIndex: number;
  createdEpoch?: number;
};

export type PurpleAirGroupDetail = PurpleAirGroup & {
  members: PurpleAirMember[];
};

const BASE = "https://api.purpleair.com/v1";

export type HttpRequest = {
  url: string;
  method: "GET" | "POST" | "DELETE";
  headers: Record<string, string>;
  body?: string;
};

function authHeaders(auth: PurpleAirAuth, write = false): Record<string, string> {
  const headers: Record<string, string> = { "X-API-Key": auth.readKey };
  if (write && auth.writeKey) headers["X-API-Key"] = auth.writeKey;
  return headers;
}

/** Build a request that lists groups available to the read/write key. */
export function buildListGroupsRequest(auth: PurpleAirAuth): HttpRequest {
  return { url: `${BASE}/groups`, method: "GET", headers: authHeaders(auth) };
}

/** Build a request that fetches one group's detail (with members). */
export function buildGetGroupDetailRequest(auth: PurpleAirAuth, groupId: number): HttpRequest {
  return { url: `${BASE}/groups/${groupId}`, method: "GET", headers: authHeaders(auth) };
}

/** Build a request that creates a new group. */
export function buildCreateGroupRequest(auth: PurpleAirAuth, name: string): HttpRequest {
  return {
    url: `${BASE}/groups`,
    method: "POST",
    headers: { ...authHeaders(auth, true), "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  };
}

/** Build a request that deletes a group. */
export function buildDeleteGroupRequest(auth: PurpleAirAuth, groupId: number): HttpRequest {
  return { url: `${BASE}/groups/${groupId}`, method: "DELETE", headers: authHeaders(auth, true) };
}

/** Build a request that adds a sensor to a group. */
export function buildAddMemberRequest(
  auth: PurpleAirAuth,
  groupId: number,
  sensorIndex: number,
): HttpRequest {
  return {
    url: `${BASE}/groups/${groupId}/members`,
    method: "POST",
    headers: { ...authHeaders(auth, true), "Content-Type": "application/json" },
    body: JSON.stringify({ sensor_index: sensorIndex }),
  };
}

/** Build a request that removes a sensor from a group. */
export function buildRemoveMemberRequest(
  auth: PurpleAirAuth,
  groupId: number,
  memberId: number,
): HttpRequest {
  return {
    url: `${BASE}/groups/${groupId}/members/${memberId}`,
    method: "DELETE",
    headers: authHeaders(auth, true),
  };
}

/** Build a request that fetches the latest live data for all group members. */
export function buildGetMembersDataRequest(
  auth: PurpleAirAuth,
  groupId: number,
  fields: ReadonlyArray<string> = ["pm2.5_alt", "humidity", "temperature"],
): HttpRequest {
  const qs = `?fields=${fields.map(encodeURIComponent).join(",")}`;
  return {
    url: `${BASE}/groups/${groupId}/members/data${qs}`,
    method: "GET",
    headers: authHeaders(auth),
  };
}

/** Build a request that fetches per-member history for a window. */
export function buildGetMemberHistoryRequest(
  auth: PurpleAirAuth,
  groupId: number,
  memberId: number,
  startSeconds: number,
  endSeconds: number,
  fields: ReadonlyArray<string> = ["pm2.5_alt"],
): HttpRequest {
  const qs = `?start_timestamp=${startSeconds}&end_timestamp=${endSeconds}&fields=${fields.join(",")}`;
  return {
    url: `${BASE}/groups/${groupId}/members/${memberId}/history${qs}`,
    method: "GET",
    headers: authHeaders(auth),
  };
}

export type GroupResponse = {
  group?: PurpleAirGroup;
  groups?: PurpleAirGroup[];
  members?: PurpleAirMember[];
};

/** Parse PurpleAir group/list payloads into typed shape. */
export function parseGroupResponse(payload: unknown): GroupResponse {
  if (!payload || typeof payload !== "object") return {};
  const p = payload as Record<string, unknown>;
  return {
    group: p.group as PurpleAirGroup | undefined,
    groups: p.groups as PurpleAirGroup[] | undefined,
    members: p.members as PurpleAirMember[] | undefined,
  };
}
