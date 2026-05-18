import { describe, expect, it } from "vitest";

import { InMemoryPurpleAirGroupClient } from "./purpleairGroups";

describe("InMemoryPurpleAirGroupClient", () => {
  it("creates a group, adds members, lists them, and removes them", async () => {
    const client = new InMemoryPurpleAirGroupClient();
    const group = await client.createGroup({ name: "Vancouver pilot" });
    expect(group.groupId).toBe(1);

    const added = await client.addMembers({ groupId: group.groupId, sensorIndices: [101, 202, 303] });
    expect(added).toHaveLength(3);

    const members = await client.listMembers(group.groupId);
    expect(members.map((row) => row.sensorIndex).sort()).toEqual([101, 202, 303]);

    const groups = await client.listGroups();
    expect(groups[0].memberCount).toBe(3);

    await client.removeMembers({ groupId: group.groupId, memberIds: [added[0].memberId!, added[2].memberId!] });
    const remaining = await client.listMembers(group.groupId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].sensorIndex).toBe(202);
  });

  it("throws when adding members to an unknown group", async () => {
    const client = new InMemoryPurpleAirGroupClient();
    await expect(client.addMembers({ groupId: 999, sensorIndices: [1] })).rejects.toThrow();
  });
});
