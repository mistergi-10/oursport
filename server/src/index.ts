import { createHash, randomInt } from "node:crypto";

import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { and, asc, desc, eq, gt, isNull, lt, ne, notExists, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { authenticate, AuthenticationError, issueToken } from "./auth.js";
import { getDatabase } from "./db/client.js";
import {
  blocks,
  conversationReads,
  conversations,
  eventMembers,
  events,
  matches,
  messages,
  passwordResetCodes,
  profiles,
  reports,
  swipes,
  users,
} from "./db/schema.js";
import { sendPasswordResetEmail } from "./email.js";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "./passwords.js";

const app = Fastify({ logger: true });
const port = Number(process.env.PORT ?? 10000);
// A compressed data: URI rather than an external object-storage URL (no bucket
// is provisioned yet); capped well under the profiles.photo_url column's use as
// a small inline avatar so a single photo can't bloat a row.
const photoUrlSchema = z
  .string()
  .trim()
  .max(350_000)
  .regex(/^data:image\/(png|jpeg|jpg|webp);base64,/)
  .nullable()
  .optional();
const profileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  city: z.string().trim().min(1).max(120),
  sport: z.string().trim().min(1).max(40),
  level: z.string().trim().min(1).max(40),
  photoUrl: photoUrlSchema,
});
const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
});
const signupSchema = credentialsSchema.extend(profileSchema.shape);
const resetRequestSchema = z.object({ email: credentialsSchema.shape.email });
const resetConfirmSchema = z.object({
  email: credentialsSchema.shape.email,
  code: z.string().regex(/^\d{6}$/),
  newPassword: z.string().min(8).max(200),
});
const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().trim().min(1).optional(),
});
const discoverQuerySchema = paginationQuerySchema.extend({
  sport: z.string().trim().min(1).max(40).optional(),
});
const messagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().trim().min(1).optional(),
});
const conversationParamsSchema = z.object({
  conversationId: z.string().uuid(),
});
const messageBodySchema = z.object({
  body: z.string().trim().min(1).max(2000),
});
const swipeSchema = z.object({
  targetUserId: z.string().uuid(),
  action: z.enum(["like", "pass"]),
});
const isoDateString = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Invalid date" });
const eventCreateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  sport: z.string().trim().min(1).max(40),
  city: z.string().trim().min(1).max(120),
  startsAt: isoDateString.refine((value) => new Date(value).getTime() > Date.now(), {
    message: "startsAt must be strictly in the future",
  }),
  description: z.string().trim().max(1000).optional(),
  capacity: z.coerce.number().int().min(2).max(100),
});
const eventsQuerySchema = z.object({
  city: z.string().trim().min(1).max(120).optional(),
  sport: z.string().trim().min(1).max(40).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().trim().min(1).optional(),
});
const eventParamsSchema = z.object({
  eventId: z.string().uuid(),
});
const blockBodySchema = z.object({
  userId: z.string().uuid(),
});
const blockParamsSchema = z.object({
  userId: z.string().uuid(),
});
const reportSchema = z.object({
  userId: z.string().uuid(),
  reason: z.enum((["spam", "harassment", "fake_profile", "inappropriate_content", "other"] as const)),
  note: z.string().trim().max(1000).optional(),
});
const deleteMeSchema = z.object({
  password: z.string().min(1).max(200).optional(),
});

app.register(cors, {
  origin: process.env.CORS_ORIGIN?.split(",") ?? true,
});

// Tolerates a body-less request sent with "content-type: application/json" (e.g.
// join/leave event, unblock) instead of the default 400, since those routes never
// require a body in the first place.
app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
  if (body === "") {
    done(null, undefined);
    return;
  }
  try {
    done(null, JSON.parse(body as string));
  } catch (error) {
    const parseError = error as Error & { statusCode?: number };
    parseError.statusCode = 400;
    done(parseError, undefined);
  }
});

app.register(rateLimit, {
  global: false,
  errorResponseBuilder: () => ({ error: "Too many requests" }),
});

function ipAndEmailKey(request: { ip: string; body?: unknown }) {
  const body = request.body as { email?: string } | undefined;
  const email = body?.email?.trim().toLowerCase() ?? "";
  return `${request.ip}:${email}`;
}

// Buckets rate limits per authenticated identity (verified JWT subject, or dev
// X-User-Id) instead of per-IP, so one shared IP can't over-throttle multiple
// legitimate users and one abusive account can't dodge limits by rotating IPs.
async function userIdKey(request: { headers: Parameters<typeof authenticate>[0]; ip: string }) {
  try {
    const identity = await authenticate(request.headers);
    return identity.userId ?? identity.subject;
  } catch {
    return request.ip;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "23505"
  );
}

function encodeCursor(sortAt: Date, id: string) {
  return Buffer.from(`${sortAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { sortAt: Date; id: string } | null {
  try {
    const [sortAtRaw, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (!sortAtRaw || !id) return null;
    const sortAt = new Date(sortAtRaw);
    if (Number.isNaN(sortAt.getTime())) return null;
    return { sortAt, id };
  } catch {
    return null;
  }
}

app.get("/", async () => ({
  service: "oursport-api",
  status: "ok",
  health: "/health",
  readiness: "/ready",
}));

app.get("/health", async () => ({ status: "ok" }));

app.get("/ready", async (_request, reply) => {
  try {
    await getDatabase().execute("select 1");
    return { status: "ok", database: "ok" };
  } catch {
    return reply.code(503).send({ status: "error", database: "unavailable" });
  }
});

app.post(
  "/v1/auth/signup",
  { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
  async (request, reply) => {
  const body = signupSchema.parse(request.body);
  const database = getDatabase();

  const [existing] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, body.email));
  if (existing) return reply.code(409).send({ error: "Email is already registered" });

  const authSubject = `password:${body.email}`;
  let user: { id: string };
  try {
    [user] = await database
      .insert(users)
      .values({ authSubject, email: body.email, passwordHash: hashPassword(body.password) })
      .returning({ id: users.id });
  } catch (error) {
    // A concurrent signup for the same email can slip past the earlier check; the
    // unique constraint on users.email is the source of truth.
    if (isUniqueViolation(error)) return reply.code(409).send({ error: "Email is already registered" });
    throw error;
  }

  const [profile] = await database
    .insert(profiles)
    .values({
      userId: user.id,
      displayName: body.name,
      city: body.city,
      sport: body.sport,
      level: body.level,
    })
    .returning();

  const token = await issueToken(authSubject, 0);
  return reply.code(201).send({ token, profile: toProfileResponse(profile) });
  },
);

app.post(
  "/v1/auth/login",
  {
    config: {
      rateLimit: { max: 10, timeWindow: "10 minutes", hook: "preHandler", keyGenerator: ipAndEmailKey },
    },
  },
  async (request, reply) => {
  const body = credentialsSchema.parse(request.body);
  const database = getDatabase();

  const [user] = await database
    .select()
    .from(users)
    .where(eq(users.email, body.email));

  // Always perform a real password compare, even for unknown emails, so response
  // timing doesn't reveal whether the email is registered.
  const passwordValid = verifyPassword(body.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user?.passwordHash || !passwordValid) {
    return reply.code(401).send({ error: "Invalid email or password" });
  }

  const [profile] = await database
    .select()
    .from(profiles)
    .where(eq(profiles.userId, user.id));

  const token = await issueToken(user.authSubject, user.tokenVersion);
  return reply.send({ token, profile: profile ? toProfileResponse(profile) : null });
  },
);

app.post(
  "/v1/auth/password-reset/request",
  {
    config: {
      rateLimit: { max: 5, timeWindow: "15 minutes", hook: "preHandler", keyGenerator: ipAndEmailKey },
    },
  },
  async (request, reply) => {
    const body = resetRequestSchema.parse(request.body);
    const database = getDatabase();

    const [user] = await database
      .select()
      .from(users)
      .where(eq(users.email, body.email));

    if (user) {
      await database
        .update(passwordResetCodes)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordResetCodes.userId, user.id), isNull(passwordResetCodes.usedAt)));

      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      await database.insert(passwordResetCodes).values({
        userId: user.id,
        codeHash: createHash("sha256").update(code).digest("hex"),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      });

      try {
        await sendPasswordResetEmail(body.email, code);
      } catch (error) {
        // Never let a delivery failure change the response shape; that would leak
        // whether the email is registered and would break the dev-only resetCode path.
        app.log.error(error, "Failed to send password reset email");
      }

      if (process.env.NODE_ENV !== "production") {
        return reply.code(202).send({ status: "ok", resetCode: code });
      }
    }

    return reply.code(202).send({ status: "ok" });
  },
);

app.post(
  "/v1/auth/password-reset/confirm",
  { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
  async (request, reply) => {
    const body = resetConfirmSchema.parse(request.body);
    const database = getDatabase();

    const [user] = await database
      .select()
      .from(users)
      .where(eq(users.email, body.email));

    if (!user) {
      return reply.code(400).send({ error: "Invalid or expired code" });
    }

    const codeHash = createHash("sha256").update(body.code).digest("hex");

    const success = await database.transaction(async (tx) => {
      const [resetCode] = await tx
        .select()
        .from(passwordResetCodes)
        .where(
          and(
            eq(passwordResetCodes.userId, user.id),
            eq(passwordResetCodes.codeHash, codeHash),
            isNull(passwordResetCodes.usedAt),
            gt(passwordResetCodes.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(passwordResetCodes.createdAt))
        .limit(1);

      if (!resetCode) return false;

      // Atomically claim the code; a concurrent request loses the WHERE match once this commits.
      const [claimed] = await tx
        .update(passwordResetCodes)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordResetCodes.id, resetCode.id), isNull(passwordResetCodes.usedAt)))
        .returning({ id: passwordResetCodes.id });

      if (!claimed) return false;

      await tx
        .update(users)
        .set({ passwordHash: hashPassword(body.newPassword), tokenVersion: user.tokenVersion + 1 })
        .where(eq(users.id, user.id));

      return true;
    });

    if (!success) {
      return reply.code(400).send({ error: "Invalid or expired code" });
    }

    return reply.code(200).send({ status: "ok" });
  },
);

app.get("/v1/me", async (request, reply) => {
  const identity = await authenticate(request.headers);
  const database = getDatabase();
  const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

  const [profile] = await database
    .select()
    .from(profiles)
    .where(eq(profiles.userId, userId));

  if (!profile) return reply.code(404).send({ error: "Profile not found" });
  return toProfileResponse(profile);
});

app.post("/v1/profiles", async (request, reply) => {
  const identity = await authenticate(request.headers);
  const body = profileSchema.parse(request.body);
  const database = getDatabase();
  const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

  await database
    .insert(users)
    .values({ id: userId, authSubject: identity.subject })
    .onConflictDoNothing();
  const [profile] = await database
    .insert(profiles)
    .values({
      userId,
      displayName: body.name,
      city: body.city,
      sport: body.sport,
      level: body.level,
      photoUrl: body.photoUrl ?? null,
    })
    .onConflictDoUpdate({
      target: profiles.userId,
      set: {
        displayName: body.name,
        city: body.city,
        sport: body.sport,
        level: body.level,
        updatedAt: new Date(),
        ...(body.photoUrl !== undefined ? { photoUrl: body.photoUrl } : {}),
      },
    })
    .returning();

  return reply.code(201).send(toProfileResponse(profile));
});

app.patch("/v1/me", async (request, reply) => {
  const identity = await authenticate(request.headers);
  const body = profileSchema.parse(request.body);
  const database = getDatabase();
  const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

  const [profile] = await database
    .update(profiles)
    .set({
      displayName: body.name,
      city: body.city,
      sport: body.sport,
      level: body.level,
      updatedAt: new Date(),
      ...(body.photoUrl !== undefined ? { photoUrl: body.photoUrl } : {}),
    })
    .where(eq(profiles.userId, userId))
    .returning();

  if (!profile) return reply.code(404).send({ error: "Profile not found" });
  return toProfileResponse(profile);
});

app.get("/v1/discover", async (request, reply) => {
  const identity = await authenticate(request.headers);
  const query = discoverQuerySchema.parse(request.query);
  const database = getDatabase();
  const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

  const [callerProfile] = await database
    .select({ city: profiles.city, sport: profiles.sport })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  if (!callerProfile) return reply.code(404).send({ error: "Profile not found" });

  let cursor: { sortAt: Date; id: string } | null = null;
  if (query.cursor) {
    cursor = decodeCursor(query.cursor);
    if (!cursor) return reply.code(400).send({ error: "Invalid cursor" });
  }

  const alreadySwiped = database
    .select({ targetUserId: swipes.targetUserId })
    .from(swipes)
    .where(eq(swipes.actorUserId, userId));

  const rows = await database
    .select({
      userId: profiles.userId,
      name: profiles.displayName,
      city: profiles.city,
      sport: profiles.sport,
      level: profiles.level,
      bio: profiles.bio,
      photoUrl: profiles.photoUrl,
      createdAt: profiles.createdAt,
    })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(
      and(
        ne(profiles.userId, userId),
        isNull(users.deletedAt),
        or(eq(profiles.city, callerProfile.city), eq(profiles.sport, callerProfile.sport)),
        query.sport ? eq(profiles.sport, query.sport) : undefined,
        notInArray(profiles.userId, alreadySwiped),
        // Already-swiped candidates are excluded above; this is a defense-in-depth
        // check in case a match ever exists without both reciprocal swipe rows.
        notExists(
          database
            .select({ id: matches.id })
            .from(matches)
            .where(
              or(
                and(eq(matches.userLowId, userId), eq(matches.userHighId, profiles.userId)),
                and(eq(matches.userHighId, userId), eq(matches.userLowId, profiles.userId)),
              ),
            ),
        ),
        notExists(
          database
            .select({ id: blocks.id })
            .from(blocks)
            .where(
              or(
                and(eq(blocks.blockerUserId, userId), eq(blocks.blockedUserId, profiles.userId)),
                and(eq(blocks.blockerUserId, profiles.userId), eq(blocks.blockedUserId, userId)),
              ),
            ),
        ),
        cursor
          ? or(
              lt(profiles.createdAt, cursor.sortAt),
              and(eq(profiles.createdAt, cursor.sortAt), lt(profiles.userId, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(profiles.createdAt), desc(profiles.userId))
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.userId) : null;

  return reply.send({
    candidates: page.map((row) => ({
      userId: row.userId,
      name: row.name,
      city: row.city,
      sport: row.sport,
      level: row.level,
      bio: row.bio,
      photoUrl: row.photoUrl,
    })),
    nextCursor,
  });
});

app.post(
  "/v1/swipes",
  { config: { rateLimit: { max: 120, timeWindow: "10 minutes", hook: "preHandler", keyGenerator: userIdKey } } },
  async (request, reply) => {
  const identity = await authenticate(request.headers);
  const body = swipeSchema.parse(request.body);
  const database = getDatabase();
  const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

  if (body.targetUserId === userId) {
    return reply.code(400).send({ error: "Cannot swipe on your own profile" });
  }

  // Mirrors the target-profile-not-found shape below so a blocked pair can't tell
  // "blocked" from "doesn't exist" by probing a userId they already know. Run both
  // checks concurrently so the "blocked" and "doesn't exist" paths take the same
  // number of DB round-trips before responding 404 (no timing side-channel).
  const [blocked, [targetProfile]] = await Promise.all([
    isBlocked(database, userId, body.targetUserId),
    database
      .select({
        userId: profiles.userId,
        name: profiles.displayName,
        city: profiles.city,
        sport: profiles.sport,
      })
      .from(profiles)
      .where(eq(profiles.userId, body.targetUserId)),
  ]);
  if (blocked || !targetProfile) return reply.code(404).send({ error: "Profile not found" });

  const userLowId = userId < body.targetUserId ? userId : body.targetUserId;
  const userHighId = userId < body.targetUserId ? body.targetUserId : userId;

  const result = await database.transaction(async (tx) => {
    // Serialize concurrent reciprocal swipes for this pair so the match check below
    // can't race with the other side's transaction and silently drop the match.
    // Two independent 32-bit hashtext() hashes give an effectively 64-bit lock key
    // (Postgres treats the (key1, key2) pair as one composite key), so an unrelated
    // pair colliding on both components is astronomically unlikely at any realistic
    // user count. A false collision would only add benign extra serialization, not
    // an incorrect match, since the unique (userLowId, userHighId) index still
    // guarantees correctness regardless of lock contention.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userLowId}), hashtext(${userHighId}))`);

    await tx
      .insert(swipes)
      .values({ actorUserId: userId, targetUserId: body.targetUserId, action: body.action })
      .onConflictDoUpdate({
        target: [swipes.actorUserId, swipes.targetUserId],
        set: { action: body.action, createdAt: new Date() },
      });

    if (body.action !== "like") return { matched: false as const };

    const [reciprocal] = await tx
      .select({ id: swipes.id })
      .from(swipes)
      .where(
        and(
          eq(swipes.actorUserId, body.targetUserId),
          eq(swipes.targetUserId, userId),
          eq(swipes.action, "like"),
        ),
      );
    if (!reciprocal) return { matched: false as const };

    await tx.insert(matches).values({ userLowId, userHighId }).onConflictDoNothing();

    // Re-select instead of relying on the insert's `.returning()` so we get the
    // matchId whether this call just created the row or it already existed (e.g.
    // a retried request), keeping conversation creation idempotent either way.
    const [match] = await tx
      .select({ id: matches.id })
      .from(matches)
      .where(and(eq(matches.userLowId, userLowId), eq(matches.userHighId, userHighId)));

    if (match) {
      await tx.insert(conversations).values({ matchId: match.id }).onConflictDoNothing();
    }

    return { matched: true as const };
  });

  if (!result.matched) return reply.code(201).send({ matched: false });
  return reply.code(201).send({
    matched: true,
    match: {
      userId: targetProfile.userId,
      name: targetProfile.name,
      city: targetProfile.city,
      sport: targetProfile.sport,
    },
  });
  },
);

app.get("/v1/matches", async (request, reply) => {
  const identity = await authenticate(request.headers);
  const query = paginationQuerySchema.parse(request.query);
  const database = getDatabase();
  const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

  let cursor: { sortAt: Date; id: string } | null = null;
  if (query.cursor) {
    cursor = decodeCursor(query.cursor);
    if (!cursor) return reply.code(400).send({ error: "Invalid cursor" });
  }

  const rows = await database
    .select({
      matchId: matches.id,
      userId: profiles.userId,
      name: profiles.displayName,
      city: profiles.city,
      sport: profiles.sport,
      matchedAt: matches.createdAt,
    })
    .from(matches)
    .innerJoin(
      profiles,
      and(
        or(eq(profiles.userId, matches.userLowId), eq(profiles.userId, matches.userHighId)),
        ne(profiles.userId, userId),
      ),
    )
    .where(
      and(
        or(eq(matches.userLowId, userId), eq(matches.userHighId, userId)),
        notExists(
          database
            .select({ id: blocks.id })
            .from(blocks)
            .where(
              or(
                and(eq(blocks.blockerUserId, userId), eq(blocks.blockedUserId, profiles.userId)),
                and(eq(blocks.blockerUserId, profiles.userId), eq(blocks.blockedUserId, userId)),
              ),
            ),
        ),
        cursor
          ? or(
              lt(matches.createdAt, cursor.sortAt),
              and(eq(matches.createdAt, cursor.sortAt), lt(matches.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(matches.createdAt), desc(matches.id))
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.matchedAt, last.matchId) : null;

  return reply.send({
    matches: page.map((row) => ({
      matchId: row.matchId,
      userId: row.userId,
      name: row.name,
      city: row.city,
      sport: row.sport,
      matchedAt: row.matchedAt.toISOString(),
    })),
    nextCursor,
  });
});

app.get("/v1/conversations", async (request, reply) => {
  const identity = await authenticate(request.headers);
  const query = paginationQuerySchema.parse(request.query);
  const database = getDatabase();
  const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

  let cursor: { sortAt: Date; id: string } | null = null;
  if (query.cursor) {
    cursor = decodeCursor(query.cursor);
    if (!cursor) return reply.code(400).send({ error: "Invalid cursor" });
  }

  const lastMessage = database
    .selectDistinctOn([messages.conversationId], {
      conversationId: messages.conversationId,
      body: messages.body,
      senderUserId: messages.senderUserId,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .orderBy(messages.conversationId, desc(messages.createdAt))
    .as("last_message");

  // Conversations float to the top by most recent activity, falling back to the
  // conversation's own createdAt when it has no messages yet.
  const updatedAt = sql<Date>`coalesce(${lastMessage.createdAt}, ${conversations.createdAt})`;

  const rows = await database
    .select({
      conversationId: conversations.id,
      matchId: matches.id,
      userId: profiles.userId,
      name: profiles.displayName,
      city: profiles.city,
      sport: profiles.sport,
      photoUrl: profiles.photoUrl,
      lastMessageBody: lastMessage.body,
      lastMessageSenderUserId: lastMessage.senderUserId,
      lastMessageCreatedAt: lastMessage.createdAt,
      conversationCreatedAt: conversations.createdAt,
      otherUserLastReadAt: conversationReads.lastReadAt,
    })
    .from(conversations)
    .innerJoin(matches, eq(matches.id, conversations.matchId))
    .innerJoin(
      profiles,
      and(
        or(eq(profiles.userId, matches.userLowId), eq(profiles.userId, matches.userHighId)),
        ne(profiles.userId, userId),
      ),
    )
    .leftJoin(lastMessage, eq(lastMessage.conversationId, conversations.id))
    .leftJoin(
      conversationReads,
      and(
        eq(conversationReads.conversationId, conversations.id),
        eq(conversationReads.userId, profiles.userId),
      ),
    )
    .where(
      and(
        or(eq(matches.userLowId, userId), eq(matches.userHighId, userId)),
        notExists(
          database
            .select({ id: blocks.id })
            .from(blocks)
            .where(
              or(
                and(eq(blocks.blockerUserId, userId), eq(blocks.blockedUserId, profiles.userId)),
                and(eq(blocks.blockerUserId, profiles.userId), eq(blocks.blockedUserId, userId)),
              ),
            ),
        ),
        cursor
          ? or(
              lt(updatedAt, cursor.sortAt),
              and(eq(updatedAt, cursor.sortAt), lt(conversations.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(updatedAt), desc(conversations.id))
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];
  const lastUpdatedAt = last ? last.lastMessageCreatedAt ?? last.conversationCreatedAt : null;
  const nextCursor = hasMore && last && lastUpdatedAt ? encodeCursor(lastUpdatedAt, last.conversationId) : null;

  return reply.send({
    conversations: page.map((row) => ({
      conversationId: row.conversationId,
      matchId: row.matchId,
      userId: row.userId,
      name: row.name,
      city: row.city,
      sport: row.sport,
      photoUrl: row.photoUrl,
      lastMessage: row.lastMessageCreatedAt
        ? {
            body: row.lastMessageBody,
            senderUserId: row.lastMessageSenderUserId,
            createdAt: row.lastMessageCreatedAt.toISOString(),
          }
        : null,
      lastMessageReadByOther:
        row.lastMessageSenderUserId === userId &&
        row.lastMessageCreatedAt !== null &&
        row.otherUserLastReadAt !== null &&
        row.otherUserLastReadAt >= row.lastMessageCreatedAt,
      updatedAt: (row.lastMessageCreatedAt ?? row.conversationCreatedAt).toISOString(),
    })),
    nextCursor,
  });
});

app.post(
  "/v1/conversations/:conversationId/read",
  { config: { rateLimit: { max: 120, timeWindow: "10 minutes", hook: "preHandler", keyGenerator: userIdKey } } },
  async (request, reply) => {
    const identity = await authenticate(request.headers);
    const params = conversationParamsSchema.parse(request.params);
    const database = getDatabase();
    const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

    const conversation = await findConversationForParticipant(database, params.conversationId, userId);
    if (!conversation) return reply.code(404).send({ error: "Conversation not found" });

    await database
      .insert(conversationReads)
      .values({ conversationId: conversation.id, userId, lastReadAt: new Date() })
      .onConflictDoUpdate({
        target: [conversationReads.conversationId, conversationReads.userId],
        set: { lastReadAt: new Date() },
      });

    return reply.send({ status: "ok" });
  },
);

app.get("/v1/conversations/:conversationId/messages", async (request, reply) => {
  const identity = await authenticate(request.headers);
  const params = conversationParamsSchema.parse(request.params);
  const query = messagesQuerySchema.parse(request.query);
  const database = getDatabase();
  const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

  const conversation = await findConversationForParticipant(database, params.conversationId, userId);
  if (!conversation) return reply.code(404).send({ error: "Conversation not found" });

  let cursor: { sortAt: Date; id: string } | null = null;
  if (query.cursor) {
    cursor = decodeCursor(query.cursor);
    if (!cursor) return reply.code(400).send({ error: "Invalid cursor" });
  }

  const rows = await database
    .select({
      messageId: messages.id,
      senderUserId: messages.senderUserId,
      body: messages.body,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversation.id),
        cursor
          ? or(
              lt(messages.createdAt, cursor.sortAt),
              and(eq(messages.createdAt, cursor.sortAt), lt(messages.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.messageId) : null;

  return reply.send({
    messages: page.map((row) => ({
      messageId: row.messageId,
      senderUserId: row.senderUserId,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor,
  });
});

app.post(
  "/v1/conversations/:conversationId/messages",
  { config: { rateLimit: { max: 60, timeWindow: "1 minute", hook: "preHandler", keyGenerator: userIdKey } } },
  async (request, reply) => {
  const identity = await authenticate(request.headers);
  const params = conversationParamsSchema.parse(request.params);
  const body = messageBodySchema.parse(request.body);
  const database = getDatabase();
  const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

  const conversation = await findConversationForParticipant(database, params.conversationId, userId);
  if (!conversation) return reply.code(404).send({ error: "Conversation not found" });

  const [message] = await database
    .insert(messages)
    .values({ conversationId: conversation.id, senderUserId: userId, body: body.body })
    .returning();

  return reply.code(201).send({
    messageId: message.id,
    senderUserId: message.senderUserId,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
  });
  },
);

app.post(
  "/v1/events",
  { config: { rateLimit: { max: 5, timeWindow: "60 minutes", hook: "preHandler", keyGenerator: userIdKey } } },
  async (request, reply) => {
  const identity = await authenticate(request.headers);
  const body = eventCreateSchema.parse(request.body);
  const database = getDatabase();
  const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

  const [creatorProfile] = await database
    .select({ displayName: profiles.displayName })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  if (!creatorProfile) return reply.code(404).send({ error: "Profile not found" });

  const description = body.description && body.description.length > 0 ? body.description : null;

  const { core, memberRows } = await database.transaction(async (tx) => {
    const [event] = await tx
      .insert(events)
      .values({
        creatorUserId: userId,
        title: body.title,
        sport: body.sport,
        city: body.city,
        description,
        startsAt: new Date(body.startsAt),
        capacity: body.capacity,
      })
      .returning();

    const [member] = await tx
      .insert(eventMembers)
      .values({ eventId: event.id, userId })
      .returning({ joinedAt: eventMembers.joinedAt });

    return {
      core: { ...event, creatorName: creatorProfile.displayName },
      memberRows: [{ userId, name: creatorProfile.displayName, joinedAt: member.joinedAt }],
    };
  });

  return reply.code(201).send(summarizeEvent(core, memberRows, userId));
  },
);

app.get("/v1/events", async (request, reply) => {
  const identity = await authenticate(request.headers);
  const query = eventsQuerySchema.parse(request.query);
  const database = getDatabase();
  const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

  let cursor: { sortAt: Date; id: string } | null = null;
  if (query.cursor) {
    cursor = decodeCursor(query.cursor);
    if (!cursor) return reply.code(400).send({ error: "Invalid cursor" });
  }

  const rows = await database
    .select({
      eventId: events.id,
      title: events.title,
      sport: events.sport,
      city: events.city,
      description: events.description,
      startsAt: events.startsAt,
      capacity: events.capacity,
      creatorUserId: events.creatorUserId,
      creatorName: profiles.displayName,
      attendeeCount: sql<number>`(select count(*)::int from ${eventMembers} where ${eventMembers.eventId} = ${events.id})`,
      isAttending: sql<boolean>`exists (select 1 from ${eventMembers} where ${eventMembers.eventId} = ${events.id} and ${eventMembers.userId} = ${userId})`,
    })
    .from(events)
    .innerJoin(profiles, eq(profiles.userId, events.creatorUserId))
    .where(
      and(
        gt(events.startsAt, new Date()),
        query.city ? eq(sql`lower(${events.city})`, query.city.toLowerCase()) : undefined,
        query.sport ? eq(sql`lower(${events.sport})`, query.sport.toLowerCase()) : undefined,
        cursor
          ? or(
              gt(events.startsAt, cursor.sortAt),
              and(eq(events.startsAt, cursor.sortAt), gt(events.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(asc(events.startsAt), asc(events.id))
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.startsAt, last.eventId) : null;

  return reply.send({
    events: page.map((row) => ({
      eventId: row.eventId,
      title: row.title,
      sport: row.sport,
      city: row.city,
      startsAt: row.startsAt.toISOString(),
      description: row.description,
      capacity: row.capacity,
      attendeeCount: row.attendeeCount,
      spotsLeft: row.capacity - row.attendeeCount,
      isAttending: row.isAttending,
      isCreator: row.creatorUserId === userId,
      creatorUserId: row.creatorUserId,
      creatorName: row.creatorName,
    })),
    nextCursor,
  });
});

app.get("/v1/events/:eventId", async (request, reply) => {
  const identity = await authenticate(request.headers);
  const params = eventParamsSchema.parse(request.params);
  const database = getDatabase();
  const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

  const core = await loadEventCore(database, params.eventId);
  if (!core) return reply.code(404).send({ error: "Event not found" });

  const memberRows = await loadEventMembers(database, params.eventId);

  return reply.send({
    ...summarizeEvent(core, memberRows, userId),
    attendees: memberRows.map((row) => ({ userId: row.userId, name: row.name })),
  });
});

app.post(
  "/v1/events/:eventId/join",
  { config: { rateLimit: { max: 30, timeWindow: "10 minutes", hook: "preHandler", keyGenerator: userIdKey } } },
  async (request, reply) => {
  const identity = await authenticate(request.headers);
  const params = eventParamsSchema.parse(request.params);
  const database = getDatabase();
  const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

  const result = await database.transaction(async (tx) => {
    // Serializes concurrent joins for this event so the capacity check below can't
    // race with another near-simultaneous join for the last open spot (same pattern
    // as the mutual-match path in POST /v1/swipes).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${params.eventId}))`);

    const core = await loadEventCore(tx, params.eventId);
    if (!core) return { status: "not_found" as const };
    if (core.startsAt.getTime() <= Date.now()) return { status: "past" as const };

    const memberRows = await loadEventMembers(tx, params.eventId);
    const alreadyMember = memberRows.some((row) => row.userId === userId);

    if (!alreadyMember) {
      if (memberRows.length >= core.capacity) return { status: "full" as const };
      // Defense-in-depth alongside the advisory lock, matching the matches-insert pattern in POST /v1/swipes.
      await tx.insert(eventMembers).values({ eventId: params.eventId, userId }).onConflictDoNothing();
    }

    const finalMemberRows = alreadyMember ? memberRows : await loadEventMembers(tx, params.eventId);
    return { status: "ok" as const, core, memberRows: finalMemberRows };
  });

  if (result.status === "not_found") return reply.code(404).send({ error: "Event not found" });
  if (result.status === "past") return reply.code(400).send({ error: "Event has already started" });
  if (result.status === "full") return reply.code(409).send({ error: "Event is full" });

  return reply.send(summarizeEvent(result.core, result.memberRows, userId));
  },
);

app.post(
  "/v1/events/:eventId/leave",
  { config: { rateLimit: { max: 30, timeWindow: "10 minutes", hook: "preHandler", keyGenerator: userIdKey } } },
  async (request, reply) => {
  const identity = await authenticate(request.headers);
  const params = eventParamsSchema.parse(request.params);
  const database = getDatabase();
  const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

  const result = await database.transaction(async (tx) => {
    const core = await loadEventCore(tx, params.eventId);
    if (!core) return { status: "not_found" as const };
    if (core.creatorUserId === userId) return { status: "creator" as const };

    const memberRows = await loadEventMembers(tx, params.eventId);
    const membership = memberRows.find((row) => row.userId === userId);

    if (membership) {
      await tx
        .delete(eventMembers)
        .where(and(eq(eventMembers.eventId, params.eventId), eq(eventMembers.userId, userId)));
    }

    const finalMemberRows = membership ? await loadEventMembers(tx, params.eventId) : memberRows;
    return { status: "ok" as const, core, memberRows: finalMemberRows };
  });

  if (result.status === "not_found") return reply.code(404).send({ error: "Event not found" });
  if (result.status === "creator") {
    return reply.code(400).send({ error: "Creator cannot leave their own event" });
  }

  return reply.send(summarizeEvent(result.core, result.memberRows, userId));
  },
);

app.post(
  "/v1/blocks",
  { config: { rateLimit: { max: 20, timeWindow: "10 minutes", hook: "preHandler", keyGenerator: userIdKey } } },
  async (request, reply) => {
    const identity = await authenticate(request.headers);
    const body = blockBodySchema.parse(request.body);
    const database = getDatabase();
    const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

    if (body.userId === userId) {
      return reply.code(400).send({ error: "Cannot block your own profile" });
    }

    const [targetProfile] = await database
      .select({ userId: profiles.userId })
      .from(profiles)
      .where(eq(profiles.userId, body.userId));
    if (!targetProfile) return reply.code(404).send({ error: "Profile not found" });

    await database
      .insert(blocks)
      .values({ blockerUserId: userId, blockedUserId: body.userId })
      .onConflictDoNothing();

    return reply.code(201).send({ blocked: true, userId: body.userId });
  },
);

app.delete(
  "/v1/blocks/:userId",
  { config: { rateLimit: { max: 20, timeWindow: "10 minutes", hook: "preHandler", keyGenerator: userIdKey } } },
  async (request, reply) => {
    const identity = await authenticate(request.headers);
    const params = blockParamsSchema.parse(request.params);
    const database = getDatabase();
    const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

    // Idempotent: only ever removes a block the caller placed, and a missing row is
    // not an error.
    await database
      .delete(blocks)
      .where(and(eq(blocks.blockerUserId, userId), eq(blocks.blockedUserId, params.userId)));

    return reply.send({ unblocked: true, userId: params.userId });
  },
);

app.get("/v1/blocks", async (request, reply) => {
  const identity = await authenticate(request.headers);
  const database = getDatabase();
  const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

  const rows = await database
    .select({ userId: blocks.blockedUserId, name: profiles.displayName })
    .from(blocks)
    .leftJoin(profiles, eq(profiles.userId, blocks.blockedUserId))
    .where(eq(blocks.blockerUserId, userId))
    .orderBy(desc(blocks.createdAt));

  return reply.send({
    blocked: rows.map((row) => ({ userId: row.userId, name: row.name ?? "Gelöschtes Konto" })),
  });
});

app.post(
  "/v1/reports",
  { config: { rateLimit: { max: 10, timeWindow: "60 minutes", hook: "preHandler", keyGenerator: userIdKey } } },
  async (request, reply) => {
    const identity = await authenticate(request.headers);
    const body = reportSchema.parse(request.body);
    const database = getDatabase();
    const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

    if (body.userId === userId) {
      return reply.code(400).send({ error: "Cannot report your own profile" });
    }

    const [targetProfile] = await database
      .select({ userId: profiles.userId })
      .from(profiles)
      .where(eq(profiles.userId, body.userId));
    if (!targetProfile) return reply.code(404).send({ error: "Profile not found" });

    await database.insert(reports).values({
      reporterUserId: userId,
      reportedUserId: body.userId,
      reason: body.reason,
      note: body.note && body.note.length > 0 ? body.note : null,
    });

    return reply.code(201).send({ reported: true });
  },
);

app.delete(
  "/v1/me",
  { config: { rateLimit: { max: 3, timeWindow: "60 minutes", hook: "preHandler", keyGenerator: userIdKey } } },
  async (request, reply) => {
    const identity = await authenticate(request.headers);
    const body = deleteMeSchema.parse(request.body ?? {});
    const database = getDatabase();
    const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

    const [user] = await database
      .select({ passwordHash: users.passwordHash, tokenVersion: users.tokenVersion })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) return reply.code(404).send({ error: "User not found" });

    // Always perform a real password compare, even for dev-bridge accounts with no
    // passwordHash, so response timing doesn't vary by account type.
    const passwordValid = verifyPassword(body.password ?? "", user.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (user.passwordHash && !passwordValid) {
      return reply.code(401).send({ error: "Invalid password" });
    }

    await database.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          email: null,
          passwordHash: null,
          authSubject: `deleted:${userId}`,
          tokenVersion: user.tokenVersion + 1,
          deletedAt: new Date(),
        })
        .where(eq(users.id, userId));

      await tx
        .update(profiles)
        .set({
          displayName: "Gelöschtes Konto",
          city: "Gelöscht",
          sport: "Gelöscht",
          level: "Gelöscht",
          bio: null,
          birthDate: null,
          latitude: null,
          longitude: null,
          updatedAt: new Date(),
        })
        .where(eq(profiles.userId, userId));
    });

    return reply.send({ deleted: true });
  },
);

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof AuthenticationError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ error: "Invalid request", details: error.flatten() });
  }
  app.log.error(error);
  return reply.code(500).send({ error: "Internal server error" });
});

async function resolveUserId(subject: string, developmentUserId?: string, tokenVersion?: number) {
  const database = getDatabase();

  // Dev-bridge (X-User-Id) still has to go through the same deletedAt check as the
  // JWT path below, otherwise a deleted dev account could keep acting on every route.
  if (developmentUserId) {
    const [user] = await database
      .select({ id: users.id, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.id, developmentUserId));
    if (!user || user.deletedAt) throw new AuthenticationError("User is not registered");
    return user.id;
  }

  const [user] = await database
    .select({ id: users.id, tokenVersion: users.tokenVersion, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.authSubject, subject));
  if (!user || user.deletedAt) throw new AuthenticationError("User is not registered");
  if (tokenVersion !== undefined && tokenVersion !== user.tokenVersion) {
    throw new AuthenticationError("Token has been revoked");
  }
  return user.id;
}

function toProfileResponse(profile: typeof profiles.$inferSelect) {
  return {
    userId: profile.userId,
    name: profile.displayName,
    city: profile.city,
    sport: profile.sport,
    level: profile.level,
    photoUrl: profile.photoUrl,
  };
}

// Returns null both when the conversation doesn't exist and when the caller isn't a
// participant (or a block exists between the two participants), so callers can
// respond 404 in all cases without leaking which it was.
async function findConversationForParticipant(
  database: ReturnType<typeof getDatabase>,
  conversationId: string,
  userId: string,
) {
  // Single query (left join on blocks) instead of a conversation lookup followed by
  // a separate isBlocked call, so "doesn't exist / not a participant" and "blocked"
  // take the same number of DB round-trips (no timing side-channel). A match only
  // has two participants, so a block between userLowId/userHighId is necessarily a
  // block between the caller and the other participant.
  const [conversation] = await database
    .select({
      id: conversations.id,
      matchId: conversations.matchId,
      userLowId: matches.userLowId,
      userHighId: matches.userHighId,
      blockId: blocks.id,
    })
    .from(conversations)
    .innerJoin(matches, eq(matches.id, conversations.matchId))
    .leftJoin(
      blocks,
      or(
        and(eq(blocks.blockerUserId, matches.userLowId), eq(blocks.blockedUserId, matches.userHighId)),
        and(eq(blocks.blockerUserId, matches.userHighId), eq(blocks.blockedUserId, matches.userLowId)),
      ),
    )
    .where(
      and(
        eq(conversations.id, conversationId),
        or(eq(matches.userLowId, userId), eq(matches.userHighId, userId)),
      ),
    );
  if (!conversation || conversation.blockId) return null;

  return conversation;
}

// Shared block check backing discover/swipes/matches/conversations: treats `blocks`
// as symmetric even though storage is directional (blockerUserId -> blockedUserId).
async function isBlocked(database: DatabaseOrTx, userIdA: string, userIdB: string) {
  const [row] = await database
    .select({ id: blocks.id })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerUserId, userIdA), eq(blocks.blockedUserId, userIdB)),
        and(eq(blocks.blockerUserId, userIdB), eq(blocks.blockedUserId, userIdA)),
      ),
    )
    .limit(1);
  return Boolean(row);
}

type Database = ReturnType<typeof getDatabase>;
type DatabaseOrTx = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

async function loadEventCore(database: DatabaseOrTx, eventId: string) {
  const [core] = await database
    .select({
      id: events.id,
      title: events.title,
      sport: events.sport,
      city: events.city,
      description: events.description,
      startsAt: events.startsAt,
      capacity: events.capacity,
      creatorUserId: events.creatorUserId,
      creatorName: profiles.displayName,
    })
    .from(events)
    .innerJoin(profiles, eq(profiles.userId, events.creatorUserId))
    .where(eq(events.id, eventId));
  return core ?? null;
}

// Ordered by joinedAt ASC so the creator (joined in the creation transaction) is
// always first; also doubles as the attendee count (array length) everywhere.
async function loadEventMembers(database: DatabaseOrTx, eventId: string) {
  return database
    .select({ userId: eventMembers.userId, name: profiles.displayName, joinedAt: eventMembers.joinedAt })
    .from(eventMembers)
    .innerJoin(profiles, eq(profiles.userId, eventMembers.userId))
    .where(eq(eventMembers.eventId, eventId))
    .orderBy(asc(eventMembers.joinedAt));
}

type EventCore = NonNullable<Awaited<ReturnType<typeof loadEventCore>>>;
type EventMemberRow = Awaited<ReturnType<typeof loadEventMembers>>[number];

function summarizeEvent(core: EventCore, memberRows: EventMemberRow[], userId: string) {
  const attendeeCount = memberRows.length;
  return {
    eventId: core.id,
    title: core.title,
    sport: core.sport,
    city: core.city,
    startsAt: core.startsAt.toISOString(),
    description: core.description,
    capacity: core.capacity,
    attendeeCount,
    spotsLeft: core.capacity - attendeeCount,
    isAttending: memberRows.some((row) => row.userId === userId),
    isCreator: core.creatorUserId === userId,
    creatorUserId: core.creatorUserId,
    creatorName: core.creatorName,
  };
}

async function main() {
  await app.listen({ port, host: "0.0.0.0" });
}

void main();
