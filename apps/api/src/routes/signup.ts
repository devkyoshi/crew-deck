import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../auth/password.js';
import { type AuthDeps } from '../auth/plugin.js';
import { timezoneSchema } from '../auth/routes.js';
import { findOrgBySlug } from '../auth/service.js';
import { emailEnabled, isProd } from '../config.js';
import type { EmailMessage } from '../email/sender.js';
import { verifySignupEmail } from '../email/templates.js';
import { AppError } from '../lib/errors.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { emailDomainOf, isFreeEmailDomain, slugMessage, slugProblem } from '../onboarding/rules.js';
import { provisionWorkspace } from '../onboarding/provision.js';
import { getPlatformSettings } from '../onboarding/settings.js';
import {
  USAGE_KEYS,
  WORK_TYPES,
  WORKSPACE_TEMPLATES,
  USAGE_OPTIONS,
  workTypesOf,
} from '@crew-deck/shared';

export type SendMail = (m: EmailMessage) => Promise<void>;

const SIGNUP_LINK_HOURS = 24;
const email = z.string().trim().toLowerCase().email().max(254);
const slug = z.string().trim().toLowerCase().max(40);

/** Rate limit sign-up calls per client address. */
const perClient = (max: number, window: string) => ({
  config: { rateLimit: { max, timeWindow: window, keyGenerator: (req: { ip: string }) => req.ip } },
});

export async function signupRoutes(app: FastifyInstance, deps: AuthDeps & { sendMail: SendMail }) {
  const { db, config, sessions, sendMail } = deps;
  const r = app.withTypeProvider<ZodTypeProvider>();

  async function settings() {
    const s = await getPlatformSettings(db);
    return {
      block_free_email_domains: s.blockFreeEmailDomains,
      signups_enabled: s.signupsEnabled,
      trial_days: s.trialDays,
    };
  }

  async function slugState(value: string): Promise<'ok' | 'invalid' | 'reserved' | 'taken'> {
    const problem = slugProblem(value);
    if (problem) return problem;
    return (await findOrgBySlug(db, value)) ? 'taken' : 'ok';
  }

  /** A usable sign-up request (not used, not expired), without using it. */
  async function peekSignup(tokenHash: string) {
    const r = await db.global.signupRequests.findOne({
      tokenHash,
      usedAt: null,
      expiresAt: { $gt: new Date() },
    });
    if (!r) return null;
    const account = await db.global.users.exists({ email: r.email.toLowerCase() });
    return {
      email: r.email,
      company: r.company,
      slug: r.slug,
      has_account: account,
      name: r.name,
      workType: r.workType,
      workTypes: workTypesOf(r.workType, r.workTypes),
      usage: r.usage,
    };
  }

  /** Sign-up pages work on the apex host only; a tenant host has nothing to sign up for. */
  const apexOnly = (req: { tenantSlug: string | null }) => {
    if (req.tenantSlug) throw new AppError(404, 'not_found', 'Not found');
  };

  // Plans shown on the public pricing page. Prices are display-only.
  r.get('/public/plans', async () => {
    const rows = await db.global.plans.find({ public: true }, { sort: { sort: 1 } });
    const s = await settings();
    return {
      trialDays: s.trial_days,
      plans: rows.map((p) => ({
        key: p.key,
        name: p.name,
        priceCents: p.priceCents,
        limits: p.limits,
        features: p.features,
      })),
    };
  });

  // The work types and usage options the sign-up wizard shows (step "What kind of work do you do?").
  r.get('/public/workspace-templates', async () => ({
    workTypes: WORK_TYPES.map((t) => {
      const w = WORKSPACE_TEMPLATES[t];
      return { type: t, label: w.label, blurb: w.blurb, suggestedUsage: w.suggestedUsage };
    }),
    usage: USAGE_OPTIONS,
  }));

  r.get('/signup/config', async () => {
    const s = await settings();
    return {
      signupsEnabled: s.signups_enabled,
      blockFreeEmail: s.block_free_email_domains,
      trialDays: s.trial_days,
      baseDomain: config.BASE_DOMAIN,
    };
  });

  r.get(
    '/signup/check',
    {
      schema: { querystring: z.object({ slug }) },
      ...perClient(config.AUTH_RATE_LIMIT_MAX * 6, '1 minute'),
    },
    async (req) => {
      apexOnly(req);
      const state = await slugState(req.query.slug);
      return { available: state === 'ok', reason: state === 'ok' ? null : slugMessage[state] };
    },
  );

  // Step 1: ask for a workspace. We email a link; nothing is created until it is opened.
  r.post(
    '/signup',
    {
      schema: {
        body: z.object({
          email,
          company: z.string().trim().min(2, 'Enter your company name').max(80),
          name: z.string().trim().max(100).optional(),
          slug,
          workType: z.enum(WORK_TYPES).optional(),
          workTypes: z.array(z.enum(WORK_TYPES)).min(1).max(WORK_TYPES.length).optional(),
          usage: z.array(z.enum(USAGE_KEYS as [string, ...string[]])).max(20).optional(),
        }),
      },
      ...perClient(config.AUTH_RATE_LIMIT_MAX, '1 hour'),
    },
    async (req) => {
      apexOnly(req);
      const s = await settings();
      if (!s.signups_enabled) {
        throw new AppError(
          403,
          'signups_closed',
          'Sign-ups are closed right now. Please contact us.',
        );
      }
      const b = req.body;
      if (s.block_free_email_domains && isFreeEmailDomain(emailDomainOf(b.email))) {
        throw new AppError(400, 'validation_error', 'Please use your work email', {
          email: 'Please use your work email address, not a personal mailbox',
        });
      }
      const state = await slugState(b.slug);
      if (state !== 'ok') {
        throw new AppError(400, 'validation_error', slugMessage[state], {
          slug: slugMessage[state],
        });
      }
      // At most three links per address per hour, so the form cannot be used to mail-bomb someone.
      const recent = await db.global.signupRequests.count({
        email: b.email.toLowerCase(),
        createdAt: { $gt: new Date(Date.now() - 3_600_000) },
      });
      if (recent >= 3) {
        throw new AppError(
          429,
          'too_many_requests',
          'Too many requests for this email. Try again later.',
        );
      }
      // The first kind of work is the primary one; a client that sends only `workType` still works.
      const workTypes = workTypesOf(b.workTypes?.[0] ?? b.workType, b.workTypes);
      const token = randomToken();
      await db.global.signupRequests.insert({
        tokenHash: sha256(token),
        email: b.email.toLowerCase(),
        name: b.name || null,
        company: b.company,
        slug: b.slug.toLowerCase(),
        workType: workTypes[0] ?? null,
        workTypes,
        usage: b.usage ?? [],
        expiresAt: new Date(Date.now() + SIGNUP_LINK_HOURS * 3_600_000),
      });
      const link = `${config.WEB_ORIGIN}/signup/verify?token=${encodeURIComponent(token)}`;
      try {
        await sendMail({
          to: b.email,
          ...verifySignupEmail({ company: b.company, link, expiresInHours: SIGNUP_LINK_HOURS }),
        });
      } catch (err) {
        // The link was not delivered, so say so plainly instead of pretending it was.
        req.log.error({ err }, 'sign-up email failed');
        throw new AppError(
          502,
          'email_failed',
          'We could not send the email. Please try again in a moment.',
        );
      }
      // Without an email service (local development) the link is returned so you can follow it.
      const showLink = !emailEnabled(config) && !isProd(config);
      return { ok: true, ...(showLink ? { devLink: link } : {}) };
    },
  );

  // What the verify page shows before asking for a password.
  r.post(
    '/signup/preview',
    {
      schema: { body: z.object({ token: z.string().min(10).max(200) }) },
      ...perClient(config.AUTH_RATE_LIMIT_MAX * 3, '1 minute'),
    },
    async (req) => {
      apexOnly(req);
      const row = await peekSignup(sha256(req.body.token));
      if (!row)
        throw new AppError(
          400,
          'invalid_signup_link',
          'This sign-up link is invalid or has expired',
        );
      return {
        email: row.email,
        company: row.company,
        slug: row.slug,
        hasAccount: row.has_account,
        name: row.name,
        workType: row.workType,
        usage: row.usage,
      };
    },
  );

  // Step 2: the link was opened. Create the workspace, make this person its owner, sign them in.
  r.post(
    '/signup/verify',
    {
      schema: {
        body: z.object({
          token: z.string().min(10).max(200),
          name: z.string().trim().min(1, 'Enter your name').max(100),
          password: z.string().min(MIN_PASSWORD_LENGTH).max(200).optional(),
          timezone: timezoneSchema.default('UTC'),
        }),
      },
      ...perClient(config.AUTH_RATE_LIMIT_MAX * 2, '1 minute'),
    },
    async (req) => {
      apexOnly(req);
      const hash = sha256(req.body.token);
      const row = await peekSignup(hash);
      if (!row)
        throw new AppError(
          400,
          'invalid_signup_link',
          'This sign-up link is invalid or has expired',
        );
      // A new person must choose a password. Someone who already has an account keeps theirs.
      if (!row.has_account && !req.body.password) {
        throw new AppError(400, 'validation_error', 'Choose a password', {
          password: 'Choose a password',
        });
      }
      const state = await slugState(row.slug);
      if (state !== 'ok') {
        throw new AppError(
          409,
          'slug_taken',
          'That workspace address was taken while you were signing up',
        );
      }
      const s = await settings();
      const domain = emailDomainOf(row.email);
      const out = await provisionWorkspace(db, {
        name: row.company,
        slug: row.slug,
        domain,
        ownerEmail: row.email,
        ownerName: req.body.name,
        ownerPasswordHash: req.body.password ? await hashPassword(req.body.password) : null,
        timezone: req.body.timezone,
        plan: 'business',
        trialDays: s.trial_days,
        // People on a free mailbox cannot lock invitations to "gmail.com".
        domainRestricted: !isFreeEmailDomain(domain),
        via: 'signup',
        ownerMode: 'verified',
        consumeTokenHash: hash,
        createdBy: 'signup',
        workTypes: workTypesOf(row.workType, row.workTypes),
        usage: row.usage,
      });
      const sid = await sessions.create(out.orgId, out.userId!);
      // Hand the session to the new workspace's own address with a one-time ticket.
      const ticket = await sessions.createTicket(out.orgId, sid);
      const origin = config.TENANT_ORIGIN_TEMPLATE.replace('{slug}', out.slug);
      return {
        ok: true,
        slug: out.slug,
        url: `${origin}/api/v1/auth/sso/complete?ticket=${encodeURIComponent(ticket)}`,
      };
    },
  );
}
