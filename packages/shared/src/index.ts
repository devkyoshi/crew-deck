import { z } from 'zod';

export const ORG_ROLES = ['owner', 'admin', 'member'] as const;
export const orgRoleSchema = z.enum(ORG_ROLES);
export type OrgRole = z.infer<typeof orgRoleSchema>;

export const USER_STATUSES = ['invited', 'active', 'deactivated'] as const;
export const userStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const errorResponseSchema = z.object({
  code: z.string(),
  message: z.string(),
  fields: z.record(z.string(), z.string()).optional(),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
