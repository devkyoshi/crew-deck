import type { FastifyRequest } from 'fastify';
import type { Actor } from '../permissions/can.js';

/** Builds the can() actor from an authenticated request (after requireAuth ran). */
export function actorOf(req: FastifyRequest): Actor {
  return {
    userId: req.user!.id,
    orgId: req.org!.id,
    orgRole: req.user!.orgRole,
    crmRole: req.user!.crmRole,
  };
}
