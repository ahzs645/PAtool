// ---------------------------------------------------------------------------
// purpleairGroups — TS analogue of the AirSensor R helpers for the PurpleAir
// API "group" / "member" endpoints (pa_createGroup, pa_addMember, etc.).
// This module provides the typed request / response shapes and a thin
// `PurpleAirGroupClient` interface; concrete fetch implementations live in
// worker/src so the shared package stays runtime-agnostic.
//
// The PurpleAir API reference is at https://api.purpleair.com — only the
// read/write group surface is modelled here; the data endpoints already
// have wrappers in `worker/src/purpleair.ts`.
// ---------------------------------------------------------------------------

export type PurpleAirGroupId = number;
export type PurpleAirSensorIndex = number;

export type PurpleAirGroupSummary = {
  groupId: PurpleAirGroupId;
  name: string;
  ownerEmail?: string;
  createdEpoch?: number;
  memberCount?: number;
};

export type PurpleAirMember = {
  groupId: PurpleAirGroupId;
  memberId?: number;          // server-assigned id within the group
  sensorIndex: PurpleAirSensorIndex;
  sensorName?: string;
};

export type CreateGroupRequest = {
  name: string;
};

export type AddMembersRequest = {
  groupId: PurpleAirGroupId;
  sensorIndices: readonly PurpleAirSensorIndex[];
};

export type RemoveMembersRequest = {
  groupId: PurpleAirGroupId;
  memberIds: readonly number[];
};

/**
 * Surface area for adapters that talk to the PurpleAir API. Implementations
 * are responsible for auth (X-API-Key header) and rate-limit handling.
 */
export interface PurpleAirGroupClient {
  listGroups(): Promise<PurpleAirGroupSummary[]>;
  getGroup(groupId: PurpleAirGroupId): Promise<PurpleAirGroupSummary>;
  createGroup(request: CreateGroupRequest): Promise<PurpleAirGroupSummary>;
  deleteGroup(groupId: PurpleAirGroupId): Promise<void>;
  listMembers(groupId: PurpleAirGroupId): Promise<PurpleAirMember[]>;
  addMembers(request: AddMembersRequest): Promise<PurpleAirMember[]>;
  removeMembers(request: RemoveMembersRequest): Promise<void>;
}

/**
 * Generic in-memory client useful for unit tests, dry-runs, and the
 * "preview the group config before committing" UX in the validation lab.
 * Does not talk to the real PurpleAir API.
 */
export class InMemoryPurpleAirGroupClient implements PurpleAirGroupClient {
  private nextGroupId = 1;
  private nextMemberId = 1;
  private readonly groups = new Map<PurpleAirGroupId, PurpleAirGroupSummary>();
  private readonly members = new Map<PurpleAirGroupId, PurpleAirMember[]>();

  async listGroups(): Promise<PurpleAirGroupSummary[]> {
    return [...this.groups.values()].map((group) => ({
      ...group,
      memberCount: this.members.get(group.groupId)?.length ?? 0,
    }));
  }

  async getGroup(groupId: PurpleAirGroupId): Promise<PurpleAirGroupSummary> {
    const group = this.groups.get(groupId);
    if (!group) throw new Error(`group ${groupId} not found`);
    return { ...group, memberCount: this.members.get(groupId)?.length ?? 0 };
  }

  async createGroup(request: CreateGroupRequest): Promise<PurpleAirGroupSummary> {
    const groupId = this.nextGroupId++;
    const group: PurpleAirGroupSummary = {
      groupId,
      name: request.name,
      createdEpoch: Math.floor(Date.now() / 1000),
      memberCount: 0,
    };
    this.groups.set(groupId, group);
    this.members.set(groupId, []);
    return group;
  }

  async deleteGroup(groupId: PurpleAirGroupId): Promise<void> {
    this.groups.delete(groupId);
    this.members.delete(groupId);
  }

  async listMembers(groupId: PurpleAirGroupId): Promise<PurpleAirMember[]> {
    return [...(this.members.get(groupId) ?? [])];
  }

  async addMembers(request: AddMembersRequest): Promise<PurpleAirMember[]> {
    if (!this.groups.has(request.groupId)) throw new Error(`group ${request.groupId} not found`);
    const bucket = this.members.get(request.groupId) ?? [];
    const added: PurpleAirMember[] = [];
    for (const sensorIndex of request.sensorIndices) {
      const member: PurpleAirMember = {
        groupId: request.groupId,
        memberId: this.nextMemberId++,
        sensorIndex,
      };
      bucket.push(member);
      added.push(member);
    }
    this.members.set(request.groupId, bucket);
    return added;
  }

  async removeMembers(request: RemoveMembersRequest): Promise<void> {
    const bucket = this.members.get(request.groupId);
    if (!bucket) return;
    const toRemove = new Set(request.memberIds);
    this.members.set(request.groupId, bucket.filter((member) => !member.memberId || !toRemove.has(member.memberId)));
  }
}
