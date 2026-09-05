import { prisma } from "../../src/lib/prisma";
import { generateId } from "../../src/lib/id";

/** Short random suffix so parallel/sequential test files never collide on unique fields. */
export function uniqueSuffix(): string {
  return generateId().slice(-8);
}

/** Creates a throwaway Organization (+ optionally a Branch) directly via Prisma, for tests that
 * need an existing org to nest requests under without going through the HTTP API. */
export async function createTestOrganization(namePrefix = "Test Org") {
  const suffix = uniqueSuffix();
  const organization = await prisma.organization.create({
    data: {
      id: generateId(),
      name: `${namePrefix} ${suffix}`,
      slug: `test-org-${suffix}`,
      email: `org-${suffix}@example.test`,
    },
  });
  return organization;
}

export async function createTestBranch(organizationId: string, namePrefix = "Test Branch") {
  return prisma.branch.create({
    data: {
      id: generateId(),
      organizationId,
      name: `${namePrefix} ${uniqueSuffix()}`,
    },
  });
}

export async function createTestPermission(keyPrefix = "test.permission") {
  const key = `${keyPrefix}.${uniqueSuffix()}`;
  return prisma.permission.create({ data: { id: generateId(), key } });
}

export async function createTestRole(organizationId: string, namePrefix = "TestRole") {
  return prisma.role.create({
    data: { id: generateId(), organizationId, name: `${namePrefix}-${uniqueSuffix()}` },
  });
}
