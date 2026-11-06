import { createHash, randomInt, randomUUID } from "node:crypto";

import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocketPlugin from "@fastify/websocket";
import Fastify from "fastify";
import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, ne, notExists, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { authenticate, authenticateFromToken, AuthenticationError, issueToken } from "./auth.js";
import { getDatabase } from "./db/client.js";
import {
  blocks,
  conversationReads,
  conversations,
  eventMembers,
  eventPhotos,
  eventRatings,
  events,
  eventWaitlist,
  matches,
  messages,
  passwordResetCodes,
  profiles,
  pushSubscriptions,
  reports,
  swipes,
  users,
} from "./db/schema.js";
import { sendPasswordResetEmail } from "./email.js";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "./passwords.js";
import { getVapidPublicKey, sendWebPushToUser } from "./push.js";

// `GET /v1/ws` carries its auth token as a `?token=` query param (WebSocket
// handshakes can't set custom headers); pino's default req serializer logs
// `req.url` verbatim, which would otherwise put bearer tokens/dev user ids in
// plaintext access logs. Redact that one query value, nothing else.
function redactTokenFromUrl(url: string) {
  return url.replace(/([?&]token=)[^&]+/i, "$1[redacted]");
}

const app = Fastify({
  logger: {
    serializers: {
      req(request) {
        return {
          method: request.method,
          url: redactTokenFromUrl(request.url),
          hostname: request.hostname,
          remoteAddress: request.ip,
        };
      },
    },
  },
});
const port = Number(process.env.PORT ?? 10000);

// In-process userId -> connected sockets map (a user can have multiple tabs/devices
// open); single-instance only, see Pillar 3's "Out of scope" note on pub/sub fan-out.
const socketsByUserId = new Map<string, Set<import("ws").WebSocket>>();

function registerSocket(userId: string, socket: import("ws").WebSocket) {
  const existing = socketsByUserId.get(userId);
  if (existing) {
    existing.add(socket);
  } else {
    socketsByUserId.set(userId, new Set([socket]));
  }
}

function unregisterSocket(userId: string, socket: import("ws").WebSocket) {
  const existing = socketsByUserId.get(userId);
  if (!existing) return;
  existing.delete(socket);
  if (existing.size === 0) socketsByUserId.delete(userId);
}

// Used by the push-notification call sites (Pillar 4) to skip sending a web push
// to someone already actively connected via Pillar 3's websocket.
function hasConnectedSocket(userId: string) {
  const sockets = socketsByUserId.get(userId);
  if (!sockets) return false;
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) return true;
  }
  return false;
}

function sendToUser(userId: string, payload: unknown) {
  const sockets = socketsByUserId.get(userId);
  if (!sockets || sockets.size === 0) return;
  const data = JSON.stringify(payload);
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) socket.send(data);
  }
}
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
const profileFieldsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  city: z.string().trim().min(1).max(120),
  sport: z.string().trim().min(1).max(40),
  level: z.string().trim().min(1).max(40),
  photoUrl: photoUrlSchema,
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});
// Setting only one of the pair would leave the geo-distance bucket (Pillar 1)
// silently computing nonsense, so both-or-neither is enforced at the edge.
function hasBothOrNeitherCoordinate(value: { latitude?: number; longitude?: number }) {
  return (value.latitude === undefined) === (value.longitude === undefined);
}
const profileSchema = profileFieldsSchema.refine(hasBothOrNeitherCoordinate, {
  message: "latitude and longitude must be provided together",
  path: ["longitude"],
});
const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
});
const signupSchema = credentialsSchema.extend(profileFieldsSchema.shape).refine(hasBothOrNeitherCoordinate, {
  message: "latitude and longitude must be provided together",
  path: ["longitude"],
});
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
const wsQuerySchema = z.object({
  token: z.string().trim().min(1),
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
  recurrence: z.enum(["weekly", "biweekly"]).optional(),
});
const eventsQuerySchema = z.object({
  city: z.string().trim().min(1).max(120).optional(),
  sport: z.string().trim().min(1).max(40).optional(),
  q: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().trim().min(1).optional(),
  mine: z.literal("true").optional(),
  when: z.enum(["upcoming", "past"]).optional(),
});
const eventParamsSchema = z.object({
  eventId: z.string().uuid(),
});
// Same regex/max-length as profiles.photoUrl (see Decisions in
// docs/requirements/09-events-depth.md), but required rather than nullable.
const eventPhotoCreateSchema = z.object({
  photoData: z
    .string()
    .trim()
    .max(350_000)
    .regex(/^data:image\/(png|jpeg|jpg|webp);base64,/),
  caption: z.string().trim().max(200).optional(),
});
const eventRatingBodySchema = z.object({
  stars: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(300).optional(),
});
const eventRatingParamsSchema = z.object({
  eventId: z.string().uuid(),
  rateeUserId: z.string().uuid(),
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
const pushSubscribeSchema = z.object({
  endpoint: z.string().trim().url().max(2000),
  keys: z.object({
    p256dh: z.string().trim().min(1).max(500),
    auth: z.string().trim().min(1).max(500),
  }),
});
const pushUnsubscribeSchema = z.object({
  endpoint: z.string().trim().min(1).max(2000),
});

app.register(cors, {
  origin: process.env.CORS_ORIGIN?.split(",") ?? true,
});

app.register(websocketPlugin);

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

// Discover's keyset cursor additionally encodes the relevance score, since
// pagination there sorts by (score, createdAt, userId) instead of just (createdAt, userId).
function encodeScoreCursor(score: number, sortAt: Date, id: string) {
  return Buffer.from(`${score}|${sortAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

function decodeScoreCursor(cursor: string): { score: number; sortAt: Date; id: string } | null {
  try {
    const [scoreRaw, sortAtRaw, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (!scoreRaw || !sortAtRaw || !id) return null;
    const score = Number(scoreRaw);
    if (!Number.isFinite(score)) return null;
    const sortAt = new Date(sortAtRaw);
    if (Number.isNaN(sortAt.getTime())) return null;
    return { score, sortAt, id };
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
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
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
      ...(body.latitude !== undefined ? { latitude: body.latitude, longitude: body.longitude } : {}),
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
    .select({ city: profiles.city, sport: profiles.sport, latitude: profiles.latitude, longitude: profiles.longitude })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  if (!callerProfile) return reply.code(404).send({ error: "Profile not found" });

  let cursor: { score: number; sortAt: Date; id: string } | null = null;
  if (query.cursor) {
    cursor = decodeScoreCursor(query.cursor);
    if (!cursor) return reply.code(400).send({ error: "Invalid cursor" });
  }

  const alreadySwiped = database
    .select({ targetUserId: swipes.targetUserId })
    .from(swipes)
    .where(eq(swipes.actorUserId, userId));

  // Haversine distance in km, bucketed 3 (<10km) down to 0 (>=200km or unknown);
  // only computed when the caller has coordinates, otherwise everyone gets 0.
  const distanceKmSql = sql`(2 * 6371 * asin(sqrt(
    power(sin(radians((${profiles.latitude} - ${callerProfile.latitude}) / 2)), 2) +
    cos(radians(${callerProfile.latitude})) * cos(radians(${profiles.latitude})) *
    power(sin(radians((${profiles.longitude} - ${callerProfile.longitude}) / 2)), 2)
  )))`;
  const geoBucketSql =
    callerProfile.latitude !== null && callerProfile.longitude !== null
      ? sql<number>`case
          when ${profiles.latitude} is null or ${profiles.longitude} is null then 0
          when ${distanceKmSql} < 10 then 3
          when ${distanceKmSql} < 50 then 2
          when ${distanceKmSql} < 200 then 1
          else 0
        end`
      : sql<number>`0`;
  // Deterministic relevance score: exact sport match (weight 1000) outweighs
  // exact city match (weight 100), which outweighs the geo-distance bucket
  // (weight 10, so its 0-3 range never crosses into the city-match weight);
  // createdAt is the separate final tiebreaker applied below, not part of this value.
  const scoreSql = sql<number>`(
    (case when ${profiles.sport} = ${callerProfile.sport} then 1000 else 0 end) +
    (case when ${profiles.city} = ${callerProfile.city} then 100 else 0 end) +
    (${geoBucketSql}) * 10
  )`;

  const candidatePool = database
    .select({
      userId: profiles.userId,
      name: profiles.displayName,
      city: profiles.city,
      sport: profiles.sport,
      level: profiles.level,
      bio: profiles.bio,
      photoUrl: profiles.photoUrl,
      createdAt: profiles.createdAt,
      score: scoreSql.as("score"),
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
      ),
    )
    .as("candidate_pool");

  // Wrapped in an outer select so the cursor/order can reference the computed
  // `score` column by name (Postgres can't reference a SELECT-list alias from
  // the same query's WHERE clause).
  const rows = await database
    .select()
    .from(candidatePool)
    .where(
      cursor
        ? or(
            lt(candidatePool.score, cursor.score),
            and(eq(candidatePool.score, cursor.score), lt(candidatePool.createdAt, cursor.sortAt)),
            and(
              eq(candidatePool.score, cursor.score),
              eq(candidatePool.createdAt, cursor.sortAt),
              lt(candidatePool.userId, cursor.id),
            ),
          )
        : undefined,
    )
    .orderBy(desc(candidatePool.score), desc(candidatePool.createdAt), desc(candidatePool.userId))
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeScoreCursor(last.score, last.createdAt, last.userId) : null;

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

    let conversationId: string | null = null;
    if (match) {
      await tx.insert(conversations).values({ matchId: match.id }).onConflictDoNothing();
      // Same re-select-after-upsert pattern as the match row above, so the id is
      // returned whether this call just created the conversation or it already existed.
      const [conversation] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.matchId, match.id));
      conversationId = conversation?.id ?? null;
    }

    return { matched: true as const, conversationId };
  });

  if (!result.matched) return reply.code(201).send({ matched: false });

  // Fire-and-forget: sendWebPushToUser never throws, so this can't fail or
  // delay the response that already confirms the match to the caller.
  void sendWebPushToUser(body.targetUserId, {
    type: "match",
    title: "Neues Match",
    body: "Du hast ein neues Match! Jetzt chatten.",
    conversationId: result.conversationId,
  });

  return reply.code(201).send({
    matched: true,
    match: {
      userId: targetProfile.userId,
      name: targetProfile.name,
      city: targetProfile.city,
      sport: targetProfile.sport,
    },
    conversationId: result.conversationId,
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
      senderName: profiles.displayName,
      body: messages.body,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(profiles, eq(profiles.userId, messages.senderUserId))
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
      senderName: row.senderName,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor,
  });
});

// Receive-only notification channel (Pillar 3): the socket never accepts
// client-sent chat messages, it only pushes events after the REST write path
// (below) persists them, so auth/validation stays in one place.
//
// Registered via a nested `app.register()` (not a bare `app.get()`) because
// @fastify/websocket's `{ websocket: true }` shorthand is wired up through an
// `onRoute` hook that the plugin adds when IT boots. Avvio only guarantees
// that ordering for routes declared inside a plugin function registered
// after it - a route added directly on `app` runs synchronously before the
// websocket plugin's boot step executes, so it would never get hijacked and
// would fall through to the plain (request, reply) handler instead, which is
// exactly why every upgrade attempt was failing with "socket.close is not a
// function" / HTTP 500.
app.register(async (instance) => {
  instance.get("/v1/ws", { websocket: true }, async (socket, request) => {
    const query = wsQuerySchema.safeParse(request.query);
    if (!query.success) {
      socket.close(1008, "Invalid token");
      return;
    }

    let userId: string;
    try {
      const identity = await authenticateFromToken(query.data.token);
      userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);
    } catch {
      socket.close(1008, "Unauthorized");
      return;
    }

    registerSocket(userId, socket);
    socket.on("close", () => unregisterSocket(userId, socket));
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

  const [senderProfile] = await database
    .select({ displayName: profiles.displayName })
    .from(profiles)
    .where(eq(profiles.userId, userId));

  const [message] = await database
    .insert(messages)
    .values({ conversationId: conversation.id, senderUserId: userId, body: body.body })
    .returning();

  const senderName = senderProfile?.displayName ?? "";

  // Generalizes the old two-party (userLowId/userHighId) fan-out to any number
  // of recipients, so a group event conversation delivers to every current member.
  const participantIds = await getConversationParticipantIds(database, conversation);

  const wsPayload = {
    type: "message" as const,
    conversationId: conversation.id,
    message: {
      messageId: message.id,
      senderUserId: message.senderUserId,
      senderName,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
    },
  };
  for (const participantId of participantIds) {
    sendToUser(participantId, wsPayload);
  }

  // Best-effort push to every other participant, skipped for whoever already has
  // the app open via Pillar 3's websocket (avoids double-notifying someone with chat open).
  const preview = message.body.length > 80 ? `${message.body.slice(0, 80)}…` : message.body;
  for (const participantId of participantIds) {
    if (participantId === userId || hasConnectedSocket(participantId)) continue;
    void sendWebPushToUser(participantId, {
      type: "message",
      title: "Neue Nachricht",
      body: preview,
      conversationId: conversation.id,
    });
  }

  return reply.code(201).send({
    messageId: message.id,
    senderUserId: message.senderUserId,
    senderName,
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
    const seriesId = body.recurrence ? randomUUID() : null;

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
        recurrenceRule: body.recurrence ?? null,
        seriesId,
      })
      .returning();

    const [member] = await tx
      .insert(eventMembers)
      .values({ eventId: event.id, userId })
      .returning({ joinedAt: eventMembers.joinedAt });

    // Mirrors how a match's conversations row is created in the same
    // transaction as the match (Pillar 3) — every event gets a group chat.
    const [conversation] = await tx
      .insert(conversations)
      .values({ eventId: event.id })
      .returning({ id: conversations.id });

    // Fixed 8-occurrence batch (see Decisions): the creator is auto-joined to
    // every generated occurrence too, each an independent, independently
    // joinable/leavable event row sharing only the new seriesId.
    if (body.recurrence) {
      const intervalDays = body.recurrence === "weekly" ? 7 : 14;
      const baseStartsAt = new Date(body.startsAt).getTime();
      const occurrenceValues = Array.from({ length: 8 }, (_, index) => ({
        creatorUserId: userId,
        title: body.title,
        sport: body.sport,
        city: body.city,
        description,
        startsAt: new Date(baseStartsAt + (index + 1) * intervalDays * 24 * 60 * 60 * 1000),
        capacity: body.capacity,
        recurrenceRule: body.recurrence,
        seriesId,
      }));
      const occurrences = await tx.insert(events).values(occurrenceValues).returning({ id: events.id });
      await tx.insert(conversations).values(occurrences.map((occurrence) => ({ eventId: occurrence.id })));
      await tx
        .insert(eventMembers)
        .values(occurrences.map((occurrence) => ({ eventId: occurrence.id, userId })));
    }

    return {
      core: { ...event, creatorName: creatorProfile.displayName, conversationId: conversation.id },
      memberRows: [{ userId, name: creatorProfile.displayName, joinedAt: member.joinedAt }],
    };
  });

  return reply.code(201).send(summarizeEvent(core, memberRows, [], userId));
  },
);

app.get("/v1/events", async (request, reply) => {
  const identity = await authenticate(request.headers);
  const query = eventsQuerySchema.parse(request.query);
  const database = getDatabase();
  const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

  if (query.when === "past" && query.mine !== "true") {
    return reply.code(400).send({ error: "when=past requires mine=true" });
  }

  let cursor: { sortAt: Date; id: string } | null = null;
  if (query.cursor) {
    cursor = decodeCursor(query.cursor);
    if (!cursor) return reply.code(400).send({ error: "Invalid cursor" });
  }

  const result = await fetchEventsPage(database, userId, {
    city: query.city,
    sport: query.sport,
    q: query.q,
    mine: query.mine === "true",
    when: query.when ?? "upcoming",
    cursor,
    limit: query.limit,
  });

  return reply.send(result);
});

app.get("/v1/events/for-you", async (request, reply) => {
  const identity = await authenticate(request.headers);
  const query = paginationQuerySchema.parse(request.query);
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

  const result = await fetchEventsPage(database, userId, {
    forYou: callerProfile,
    cursor,
    limit: query.limit,
  });

  return reply.send(result);
});

app.get("/v1/events/:eventId", async (request, reply) => {
  const identity = await authenticate(request.headers);
  const params = eventParamsSchema.parse(request.params);
  const database = getDatabase();
  const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

  const core = await loadEventCore(database, params.eventId);
  if (!core) return reply.code(404).send({ error: "Event not found" });
  // Guarantees conversationId is genuinely always present as documented, including
  // for events created before this slice shipped a conversations row at creation time.
  core.conversationId = await ensureEventConversationId(database, params.eventId, core.conversationId);

  const memberRows = await loadEventMembers(database, params.eventId);
  const waitlistRows = await loadEventWaitlist(database, params.eventId);

  const isPast = core.startsAt.getTime() <= Date.now();
  // Past event: everyone who was ever a member (so there's someone to rate even
  // if they later left); future event: current members only, leftAt always null.
  const attendeeRows = isPast
    ? await loadEventAttendeesEver(database, params.eventId)
    : memberRows.map((row) => ({ ...row, leftAt: null as Date | null }));
  const callerAttended = attendeeRows.some((row) => row.userId === userId);
  const ratingAggregates = await loadRatingAggregates(
    database,
    attendeeRows.map((row) => row.userId),
  );

  return reply.send({
    ...summarizeEvent(core, memberRows, waitlistRows, userId),
    attendees: attendeeRows.map((row) => {
      const aggregate = ratingAggregates.get(row.userId) ?? { averageRating: null, ratingCount: 0 };
      return {
        userId: row.userId,
        name: row.name,
        leftAt: row.leftAt ? row.leftAt.toISOString() : null,
        averageRating: aggregate.averageRating,
        ratingCount: aggregate.ratingCount,
        canRate: isPast && callerAttended && row.userId !== userId,
      };
    }),
  });
});

// Fetch-or-create: every event created going forward already gets a
// conversations row at creation time (see POST /v1/events), but events created
// before this slice shipped have none yet — this backfills one on first access.
app.get("/v1/events/:eventId/conversation", async (request, reply) => {
  const identity = await authenticate(request.headers);
  const params = eventParamsSchema.parse(request.params);
  const database = getDatabase();
  await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

  const core = await loadEventCore(database, params.eventId);
  if (!core) return reply.code(404).send({ error: "Event not found" });

  const conversationId = await ensureEventConversationId(database, params.eventId, core.conversationId);
  return reply.send({ conversationId });
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
    // Backfills events created before this slice shipped a conversations row at
    // creation time, so the response's conversationId (EventDetail contract) is never null.
    core.conversationId = await ensureEventConversationId(tx, params.eventId, core.conversationId);
    if (core.startsAt.getTime() <= Date.now()) return { status: "past" as const };

    const memberRows = await loadEventMembers(tx, params.eventId);
    const alreadyMember = memberRows.some((row) => row.userId === userId);

    if (!alreadyMember) {
      if (memberRows.length >= core.capacity) return { status: "full" as const };
      // Upsert instead of onConflictDoNothing: a prior leave leaves the
      // (eventId, userId) row in place with leftAt set, so re-joining must
      // reset leftAt/joinedAt on that same row rather than no-op (Pillar 4).
      await tx
        .insert(eventMembers)
        .values({ eventId: params.eventId, userId })
        .onConflictDoUpdate({
          target: [eventMembers.eventId, eventMembers.userId],
          set: { leftAt: null, joinedAt: new Date() },
        });
    }

    const finalMemberRows = alreadyMember ? memberRows : await loadEventMembers(tx, params.eventId);
    const waitlistRows = await loadEventWaitlist(tx, params.eventId);
    return { status: "ok" as const, core, memberRows: finalMemberRows, waitlistRows };
  });

  if (result.status === "not_found") return reply.code(404).send({ error: "Event not found" });
  if (result.status === "past") return reply.code(400).send({ error: "Event has already started" });
  if (result.status === "full") return reply.code(409).send({ error: "Event is full" });

  return reply.send(summarizeEvent(result.core, result.memberRows, result.waitlistRows, userId));
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
    // Serializes against concurrent joins/waitlist-joins/leaves for this event so
    // the auto-promotion below can't race with another capacity-affecting mutation.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${params.eventId}))`);

    const core = await loadEventCore(tx, params.eventId);
    if (!core) return { status: "not_found" as const };
    core.conversationId = await ensureEventConversationId(tx, params.eventId, core.conversationId);
    if (core.creatorUserId === userId) return { status: "creator" as const };

    const memberRows = await loadEventMembers(tx, params.eventId);
    const membership = memberRows.find((row) => row.userId === userId);

    let promotedUserId: string | null = null;
    if (membership) {
      // Soft delete (Pillar 4): keeps the row so Pillars 1-2's "ever attended"
      // checks and the mine=true&when=past filter still recognize this membership.
      await tx
        .update(eventMembers)
        .set({ leftAt: new Date() })
        .where(
          and(
            eq(eventMembers.eventId, params.eventId),
            eq(eventMembers.userId, userId),
            isNull(eventMembers.leftAt),
          ),
        );

      // Auto-promote the earliest-joined waitlisted user into the vacated spot.
      const [earliestWaitlisted] = await loadEventWaitlist(tx, params.eventId);
      if (earliestWaitlisted) {
        await tx
          .delete(eventWaitlist)
          .where(
            and(
              eq(eventWaitlist.eventId, params.eventId),
              eq(eventWaitlist.userId, earliestWaitlisted.userId),
            ),
          );
        // Upsert for the same reason as the join route: the promoted user may
        // have a past (left) event_members row already.
        await tx
          .insert(eventMembers)
          .values({ eventId: params.eventId, userId: earliestWaitlisted.userId })
          .onConflictDoUpdate({
            target: [eventMembers.eventId, eventMembers.userId],
            set: { leftAt: null, joinedAt: new Date() },
          });
        promotedUserId = earliestWaitlisted.userId;
      }
    }

    const finalMemberRows = membership ? await loadEventMembers(tx, params.eventId) : memberRows;
    const finalWaitlistRows = await loadEventWaitlist(tx, params.eventId);
    return {
      status: "ok" as const,
      core,
      memberRows: finalMemberRows,
      waitlistRows: finalWaitlistRows,
      promotedUserId,
    };
  });

  if (result.status === "not_found") return reply.code(404).send({ error: "Event not found" });
  if (result.status === "creator") {
    return reply.code(400).send({ error: "Creator cannot leave their own event" });
  }

  // Best-effort push, sent after the transaction above already committed.
  if (result.promotedUserId) {
    void sendWebPushToUser(result.promotedUserId, {
      type: "waitlist_promoted",
      title: "Platz frei geworden",
      body: `Du bist jetzt dabei: ${result.core.title}`,
      eventId: result.core.id,
    });
  }

  return reply.send(summarizeEvent(result.core, result.memberRows, result.waitlistRows, userId));
  },
);

app.post(
  "/v1/events/:eventId/waitlist",
  { config: { rateLimit: { max: 30, timeWindow: "10 minutes", hook: "preHandler", keyGenerator: userIdKey } } },
  async (request, reply) => {
  const identity = await authenticate(request.headers);
  const params = eventParamsSchema.parse(request.params);
  const database = getDatabase();
  const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

  const result = await database.transaction(async (tx) => {
    // Same advisory lock as join, so the "already attending" check below can't
    // race with a concurrent join for this event.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${params.eventId}))`);

    const core = await loadEventCore(tx, params.eventId);
    if (!core) return { status: "not_found" as const };
    core.conversationId = await ensureEventConversationId(tx, params.eventId, core.conversationId);
    if (core.creatorUserId === userId) return { status: "creator" as const };

    const memberRows = await loadEventMembers(tx, params.eventId);
    if (memberRows.some((row) => row.userId === userId)) return { status: "attending" as const };

    // Idempotent no-op if the caller is already on the waitlist.
    await tx.insert(eventWaitlist).values({ eventId: params.eventId, userId }).onConflictDoNothing();

    const waitlistRows = await loadEventWaitlist(tx, params.eventId);
    return { status: "ok" as const, core, memberRows, waitlistRows };
  });

  if (result.status === "not_found") return reply.code(404).send({ error: "Event not found" });
  if (result.status === "creator") return reply.code(400).send({ error: "Creator is already attending" });
  if (result.status === "attending") return reply.code(400).send({ error: "Already attending this event" });

  const waitlistPosition = result.waitlistRows.findIndex((row) => row.userId === userId) + 1;
  return reply.send({
    ...summarizeEvent(result.core, result.memberRows, result.waitlistRows, userId),
    waitlistPosition,
  });
  },
);

app.post(
  "/v1/events/:eventId/waitlist/leave",
  { config: { rateLimit: { max: 30, timeWindow: "10 minutes", hook: "preHandler", keyGenerator: userIdKey } } },
  async (request, reply) => {
  const identity = await authenticate(request.headers);
  const params = eventParamsSchema.parse(request.params);
  const database = getDatabase();
  const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

  const result = await database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${params.eventId}))`);

    const core = await loadEventCore(tx, params.eventId);
    if (!core) return { status: "not_found" as const };
    core.conversationId = await ensureEventConversationId(tx, params.eventId, core.conversationId);

    // Idempotent: removing a waitlist row the caller never had is not an error.
    await tx
      .delete(eventWaitlist)
      .where(and(eq(eventWaitlist.eventId, params.eventId), eq(eventWaitlist.userId, userId)));

    const memberRows = await loadEventMembers(tx, params.eventId);
    const waitlistRows = await loadEventWaitlist(tx, params.eventId);
    return { status: "ok" as const, core, memberRows, waitlistRows };
  });

  if (result.status === "not_found") return reply.code(404).send({ error: "Event not found" });

  return reply.send(summarizeEvent(result.core, result.memberRows, result.waitlistRows, userId));
  },
);

app.post(
  "/v1/events/:eventId/photos",
  { config: { rateLimit: { max: 20, timeWindow: "10 minutes", hook: "preHandler", keyGenerator: userIdKey } } },
  async (request, reply) => {
    const identity = await authenticate(request.headers);
    const params = eventParamsSchema.parse(request.params);
    const body = eventPhotoCreateSchema.parse(request.body);
    const database = getDatabase();
    const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

    const core = await loadEventCore(database, params.eventId);
    if (!core) return reply.code(404).send({ error: "Event not found" });
    if (core.startsAt.getTime() > Date.now()) {
      return reply.code(400).send({ error: "Event hasn't happened yet" });
    }

    // "Attended" = has an event_members row (current or past, leftAt either way).
    const [membership] = await database
      .select({ id: eventMembers.id })
      .from(eventMembers)
      .where(and(eq(eventMembers.eventId, params.eventId), eq(eventMembers.userId, userId)));
    if (!membership) {
      return reply.code(403).send({ error: "Only members who attended can upload photos" });
    }

    const [uploaderProfile] = await database
      .select({ displayName: profiles.displayName })
      .from(profiles)
      .where(eq(profiles.userId, userId));
    if (!uploaderProfile) return reply.code(404).send({ error: "Profile not found" });

    const caption = body.caption && body.caption.length > 0 ? body.caption : null;

    const result = await database.transaction(async (tx) => {
      // Serializes concurrent uploads for this event so the 40-photo cap can't
      // be raced past by near-simultaneous uploads (same pattern as event join).
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${params.eventId}:photos`}))`);

      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(eventPhotos)
        .where(eq(eventPhotos.eventId, params.eventId));
      if (count >= 40) return { status: "full" as const };

      const [photo] = await tx
        .insert(eventPhotos)
        .values({ eventId: params.eventId, uploaderUserId: userId, photoData: body.photoData, caption })
        .returning();
      return { status: "ok" as const, photo };
    });

    if (result.status === "full") {
      return reply.code(400).send({ error: "Photo gallery is full for this event" });
    }

    return reply.code(201).send({
      photoId: result.photo.id,
      eventId: result.photo.eventId,
      uploaderUserId: result.photo.uploaderUserId,
      uploaderName: uploaderProfile.displayName,
      photoData: result.photo.photoData,
      caption: result.photo.caption,
      createdAt: result.photo.createdAt.toISOString(),
    });
  },
);

app.get("/v1/events/:eventId/photos", async (request, reply) => {
  const identity = await authenticate(request.headers);
  const params = eventParamsSchema.parse(request.params);
  const query = paginationQuerySchema.parse(request.query);
  const database = getDatabase();
  const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

  const core = await loadEventCore(database, params.eventId);
  if (!core) return reply.code(404).send({ error: "Event not found" });

  const [membership] = await database
    .select({ id: eventMembers.id })
    .from(eventMembers)
    .where(and(eq(eventMembers.eventId, params.eventId), eq(eventMembers.userId, userId)));
  if (!membership) {
    return reply.code(403).send({ error: "Only members who attended can upload photos" });
  }

  let cursor: { sortAt: Date; id: string } | null = null;
  if (query.cursor) {
    cursor = decodeCursor(query.cursor);
    if (!cursor) return reply.code(400).send({ error: "Invalid cursor" });
  }

  const rows = await database
    .select({
      photoId: eventPhotos.id,
      uploaderUserId: eventPhotos.uploaderUserId,
      uploaderName: profiles.displayName,
      photoData: eventPhotos.photoData,
      caption: eventPhotos.caption,
      createdAt: eventPhotos.createdAt,
    })
    .from(eventPhotos)
    .innerJoin(profiles, eq(profiles.userId, eventPhotos.uploaderUserId))
    .where(
      and(
        eq(eventPhotos.eventId, params.eventId),
        cursor
          ? or(
              lt(eventPhotos.createdAt, cursor.sortAt),
              and(eq(eventPhotos.createdAt, cursor.sortAt), lt(eventPhotos.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(eventPhotos.createdAt), desc(eventPhotos.id))
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.photoId) : null;

  return reply.send({
    photos: page.map((row) => ({
      photoId: row.photoId,
      uploaderUserId: row.uploaderUserId,
      uploaderName: row.uploaderName,
      photoData: row.photoData,
      caption: row.caption,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor,
  });
});

app.post(
  "/v1/events/:eventId/ratings/:rateeUserId",
  { config: { rateLimit: { max: 30, timeWindow: "10 minutes", hook: "preHandler", keyGenerator: userIdKey } } },
  async (request, reply) => {
    const identity = await authenticate(request.headers);
    const params = eventRatingParamsSchema.parse(request.params);
    const body = eventRatingBodySchema.parse(request.body);
    const database = getDatabase();
    const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

    const core = await loadEventCore(database, params.eventId);
    if (!core) return reply.code(404).send({ error: "Event not found" });
    if (core.startsAt.getTime() > Date.now()) {
      return reply.code(400).send({ error: "Event hasn't happened yet" });
    }
    if (params.rateeUserId === userId) {
      return reply.code(400).send({ error: "Cannot rate yourself" });
    }

    // "Attended" = has an event_members row (current or past); one query covering
    // both sides, checked together so the response can't leak which side failed.
    const attendedRows = await database
      .select({ userId: eventMembers.userId })
      .from(eventMembers)
      .where(
        and(
          eq(eventMembers.eventId, params.eventId),
          inArray(eventMembers.userId, [userId, params.rateeUserId]),
        ),
      );
    const attendedUserIds = new Set(attendedRows.map((row) => row.userId));
    if (!attendedUserIds.has(userId) || !attendedUserIds.has(params.rateeUserId)) {
      return reply.code(403).send({ error: "Both must have attended this event to rate" });
    }

    const comment = body.comment && body.comment.length > 0 ? body.comment : null;
    const now = new Date();
    const [rating] = await database
      .insert(eventRatings)
      .values({
        eventId: params.eventId,
        raterUserId: userId,
        rateeUserId: params.rateeUserId,
        stars: body.stars,
        comment,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [eventRatings.eventId, eventRatings.raterUserId, eventRatings.rateeUserId],
        set: { stars: body.stars, comment, updatedAt: now },
      })
      .returning();

    return reply.send({
      eventId: rating.eventId,
      rateeUserId: rating.rateeUserId,
      stars: rating.stars,
      comment: rating.comment,
      createdAt: rating.createdAt.toISOString(),
      updatedAt: rating.updatedAt.toISOString(),
    });
  },
);

app.get("/v1/users/me/ratings", async (request, reply) => {
  const identity = await authenticate(request.headers);
  const query = paginationQuerySchema.parse(request.query);
  const database = getDatabase();
  const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

  let cursor: { sortAt: Date; id: string } | null = null;
  if (query.cursor) {
    cursor = decodeCursor(query.cursor);
    if (!cursor) return reply.code(400).send({ error: "Invalid cursor" });
  }

  // Computed independently of the current page — a full aggregate, not derived
  // from the returned slice.
  const [summaryRow] = await database
    .select({
      averageRating: sql<number | null>`avg(${eventRatings.stars})::float`,
      ratingCount: sql<number>`count(*)::int`,
    })
    .from(eventRatings)
    .where(eq(eventRatings.rateeUserId, userId));

  const rows = await database
    .select({
      ratingId: eventRatings.id,
      eventId: eventRatings.eventId,
      eventTitle: events.title,
      raterUserId: eventRatings.raterUserId,
      raterName: profiles.displayName,
      stars: eventRatings.stars,
      comment: eventRatings.comment,
      createdAt: eventRatings.createdAt,
    })
    .from(eventRatings)
    .innerJoin(events, eq(events.id, eventRatings.eventId))
    .innerJoin(profiles, eq(profiles.userId, eventRatings.raterUserId))
    .where(
      and(
        eq(eventRatings.rateeUserId, userId),
        cursor
          ? or(
              lt(eventRatings.createdAt, cursor.sortAt),
              and(eq(eventRatings.createdAt, cursor.sortAt), lt(eventRatings.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(eventRatings.createdAt), desc(eventRatings.id))
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.ratingId) : null;

  return reply.send({
    summary: {
      averageRating: summaryRow?.averageRating ?? null,
      ratingCount: summaryRow?.ratingCount ?? 0,
    },
    ratings: page.map((row) => ({
      ratingId: row.ratingId,
      eventId: row.eventId,
      eventTitle: row.eventTitle,
      raterUserId: row.raterUserId,
      raterName: row.raterName,
      stars: row.stars,
      comment: row.comment,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor,
  });
});

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

// Public (no auth): the VAPID public key is not user-specific, same value for
// every client. Returns null rather than throwing when unset (dev/CI/Render
// without the env var configured yet) so callers can degrade gracefully.
app.get("/v1/push/public-key", async (_request, reply) => {
  return reply.send({ publicKey: getVapidPublicKey() });
});

app.post(
  "/v1/push/subscribe",
  { config: { rateLimit: { max: 20, timeWindow: "10 minutes", hook: "preHandler", keyGenerator: userIdKey } } },
  async (request, reply) => {
    const identity = await authenticate(request.headers);
    const body = pushSubscribeSchema.parse(request.body);
    const database = getDatabase();
    const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

    // Re-associates the endpoint with the current caller on conflict (e.g. a
    // shared browser where a different account subsequently subscribes).
    await database
      .insert(pushSubscriptions)
      .values({
        userId,
        endpoint: body.endpoint,
        p256dhKey: body.keys.p256dh,
        authKey: body.keys.auth,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId, p256dhKey: body.keys.p256dh, authKey: body.keys.auth },
      });

    return reply.code(201).send({ subscribed: true });
  },
);

app.post(
  "/v1/push/unsubscribe",
  { config: { rateLimit: { max: 20, timeWindow: "10 minutes", hook: "preHandler", keyGenerator: userIdKey } } },
  async (request, reply) => {
    const identity = await authenticate(request.headers);
    const body = pushUnsubscribeSchema.parse(request.body);
    const database = getDatabase();
    const userId = await resolveUserId(identity.subject, identity.userId, identity.tokenVersion);

    // Idempotent: removing a subscription the caller never had is not an error.
    await database
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, body.endpoint)));

    return reply.send({ unsubscribed: true });
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
// participant (match pair, or — Pillar 3 — a current event member), so callers can
// respond 404 in all cases without leaking which it was.
async function findConversationForParticipant(
  database: DatabaseOrTx,
  conversationId: string,
  userId: string,
) {
  const [conversation] = await database
    .select({ id: conversations.id, matchId: conversations.matchId, eventId: conversations.eventId })
    .from(conversations)
    .where(eq(conversations.id, conversationId));
  if (!conversation) return null;

  if (conversation.eventId) {
    // Event group conversation: authorized iff the caller currently (leftAt IS
    // NULL) belongs to the event. The `blocks` check is intentionally not
    // applied here — generalizing pairwise blocking to an N-party room is out
    // of scope for this slice (see docs/requirements/09-events-depth.md).
    const [membership] = await database
      .select({ id: eventMembers.id })
      .from(eventMembers)
      .where(
        and(
          eq(eventMembers.eventId, conversation.eventId),
          eq(eventMembers.userId, userId),
          isNull(eventMembers.leftAt),
        ),
      );
    return membership ? conversation : null;
  }

  if (!conversation.matchId) return null;

  // Single query (left join on blocks) instead of a separate isBlocked call, so
  // "not a participant" and "blocked" take the same number of DB round-trips (no
  // timing side-channel). A match only has two participants, so a block between
  // userLowId/userHighId is necessarily a block between the caller and the other participant.
  const [match] = await database
    .select({ blockId: blocks.id })
    .from(matches)
    .leftJoin(
      blocks,
      or(
        and(eq(blocks.blockerUserId, matches.userLowId), eq(blocks.blockedUserId, matches.userHighId)),
        and(eq(blocks.blockerUserId, matches.userHighId), eq(blocks.blockedUserId, matches.userLowId)),
      ),
    )
    .where(
      and(
        eq(matches.id, conversation.matchId),
        or(eq(matches.userLowId, userId), eq(matches.userHighId, userId)),
      ),
    );
  if (!match || match.blockId) return null;

  return conversation;
}

// All current (leftAt IS NULL, for event conversations) recipients of a
// conversation, for websocket fan-out and push — generalizes the old two-party
// (userLowId/userHighId) assumption to a group of any size.
async function getConversationParticipantIds(
  database: DatabaseOrTx,
  conversation: { matchId: string | null; eventId: string | null },
) {
  if (conversation.eventId) {
    const rows = await database
      .select({ userId: eventMembers.userId })
      .from(eventMembers)
      .where(and(eq(eventMembers.eventId, conversation.eventId), isNull(eventMembers.leftAt)));
    return rows.map((row) => row.userId);
  }
  if (conversation.matchId) {
    const [match] = await database
      .select({ userLowId: matches.userLowId, userHighId: matches.userHighId })
      .from(matches)
      .where(eq(matches.id, conversation.matchId));
    return match ? [match.userLowId, match.userHighId] : [];
  }
  return [];
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
      seriesId: events.seriesId,
      // Nullable: events created before this slice shipped have no row yet —
      // see GET /v1/events/:eventId/conversation for the lazy-backfill path.
      conversationId: conversations.id,
    })
    .from(events)
    .innerJoin(profiles, eq(profiles.userId, events.creatorUserId))
    .leftJoin(conversations, eq(conversations.eventId, events.id))
    .where(eq(events.id, eventId));
  return core ?? null;
}

// Fetch-or-create: new events already get a conversations row at creation time
// (see POST /v1/events), but events created before this slice shipped have none
// yet — this backfills one on first access so conversationId is genuinely always
// present, as documented on GET /v1/events/:eventId and this endpoint's response.
async function ensureEventConversationId(
  database: DatabaseOrTx,
  eventId: string,
  existingConversationId: string | null,
) {
  if (existingConversationId) return existingConversationId;

  const [created] = await database
    .insert(conversations)
    .values({ eventId })
    .onConflictDoNothing({ target: conversations.eventId })
    .returning({ id: conversations.id });
  if (created) return created.id;

  // Lost a race with a concurrent first-access call; re-read what it inserted.
  const [existing] = await database
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.eventId, eventId));
  return existing!.id;
}

// Ordered by joinedAt ASC so the creator (joined in the creation transaction) is
// always first; also doubles as the attendee count (array length) everywhere.
// Current members only (leftAt IS NULL) — see loadEventAttendeesEver for the
// past-event "everyone who was ever a member" variant.
async function loadEventMembers(database: DatabaseOrTx, eventId: string) {
  return database
    .select({ userId: eventMembers.userId, name: profiles.displayName, joinedAt: eventMembers.joinedAt })
    .from(eventMembers)
    .innerJoin(profiles, eq(profiles.userId, eventMembers.userId))
    .where(and(eq(eventMembers.eventId, eventId), isNull(eventMembers.leftAt)))
    .orderBy(asc(eventMembers.joinedAt));
}

// Everyone who was ever a member of the event (including past members who've
// since left), for a past event's attendee/rating list — Pillar 1/2's "attended"
// definition is "has an event_members row", regardless of leftAt.
async function loadEventAttendeesEver(database: DatabaseOrTx, eventId: string) {
  return database
    .select({
      userId: eventMembers.userId,
      name: profiles.displayName,
      joinedAt: eventMembers.joinedAt,
      leftAt: eventMembers.leftAt,
    })
    .from(eventMembers)
    .innerJoin(profiles, eq(profiles.userId, eventMembers.userId))
    .where(eq(eventMembers.eventId, eventId))
    .orderBy(asc(eventMembers.joinedAt));
}

// Global (not per-event) rating aggregates for a set of users, for the public
// averageRating/ratingCount shown next to an attendee's name.
async function loadRatingAggregates(database: DatabaseOrTx, userIds: string[]) {
  const aggregates = new Map<string, { averageRating: number | null; ratingCount: number }>();
  if (userIds.length === 0) return aggregates;

  const rows = await database
    .select({
      rateeUserId: eventRatings.rateeUserId,
      averageRating: sql<number>`avg(${eventRatings.stars})::float`,
      ratingCount: sql<number>`count(*)::int`,
    })
    .from(eventRatings)
    .where(inArray(eventRatings.rateeUserId, userIds))
    .groupBy(eventRatings.rateeUserId);

  for (const row of rows) {
    aggregates.set(row.rateeUserId, { averageRating: row.averageRating, ratingCount: row.ratingCount });
  }
  return aggregates;
}

// Ordered by joinedAt ASC so index 0 is always the next promotion candidate
// (FIFO); also doubles as the waitlist count (array length) everywhere.
async function loadEventWaitlist(database: DatabaseOrTx, eventId: string) {
  return database
    .select({ userId: eventWaitlist.userId, joinedAt: eventWaitlist.joinedAt })
    .from(eventWaitlist)
    .where(eq(eventWaitlist.eventId, eventId))
    .orderBy(asc(eventWaitlist.joinedAt));
}

type EventCore = NonNullable<Awaited<ReturnType<typeof loadEventCore>>>;
type EventMemberRow = Awaited<ReturnType<typeof loadEventMembers>>[number];
type EventWaitlistRow = Awaited<ReturnType<typeof loadEventWaitlist>>[number];

function summarizeEvent(
  core: EventCore,
  memberRows: EventMemberRow[],
  waitlistRows: EventWaitlistRow[],
  userId: string,
) {
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
    waitlistCount: waitlistRows.length,
    isWaitlisted: waitlistRows.some((row) => row.userId === userId),
    seriesId: core.seriesId,
    conversationId: core.conversationId,
  };
}

// Shared by GET /v1/events and GET /v1/events/for-you: same keyset pagination and
// response shape; the time filter/ordering direction and "mine" scoping differ.
async function fetchEventsPage(
  database: Database,
  userId: string,
  options: {
    city?: string;
    sport?: string;
    q?: string;
    forYou?: { city: string; sport: string };
    mine?: boolean;
    when?: "upcoming" | "past";
    cursor: { sortAt: Date; id: string } | null;
    limit: number;
  },
) {
  const isPast = options.when === "past";
  // mine=true&when=upcoming requires CURRENT membership (leftAt IS NULL, same as
  // isAttending elsewhere); mine=true&when=past includes anyone EVER a member,
  // including those who've since left (Pillar 4 Decision 7).
  const mineCondition = options.mine
    ? isPast
      ? sql`(${events.creatorUserId} = ${userId} or exists (select 1 from ${eventMembers} where ${eventMembers.eventId} = ${events.id} and ${eventMembers.userId} = ${userId}))`
      : sql`(${events.creatorUserId} = ${userId} or exists (select 1 from ${eventMembers} where ${eventMembers.eventId} = ${events.id} and ${eventMembers.userId} = ${userId} and ${eventMembers.leftAt} is null))`
    : undefined;

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
      seriesId: events.seriesId,
      attendeeCount: sql<number>`(select count(*)::int from ${eventMembers} where ${eventMembers.eventId} = ${events.id} and ${eventMembers.leftAt} is null)`,
      isAttending: sql<boolean>`exists (select 1 from ${eventMembers} where ${eventMembers.eventId} = ${events.id} and ${eventMembers.userId} = ${userId} and ${eventMembers.leftAt} is null)`,
      waitlistCount: sql<number>`(select count(*)::int from ${eventWaitlist} where ${eventWaitlist.eventId} = ${events.id})`,
      isWaitlisted: sql<boolean>`exists (select 1 from ${eventWaitlist} where ${eventWaitlist.eventId} = ${events.id} and ${eventWaitlist.userId} = ${userId})`,
    })
    .from(events)
    .innerJoin(profiles, eq(profiles.userId, events.creatorUserId))
    .where(
      and(
        isPast ? lte(events.startsAt, new Date()) : gt(events.startsAt, new Date()),
        mineCondition,
        options.city ? eq(sql`lower(${events.city})`, options.city.toLowerCase()) : undefined,
        options.sport ? eq(sql`lower(${events.sport})`, options.sport.toLowerCase()) : undefined,
        options.q
          ? sql`(${events.title} ilike ${`%${options.q}%`} or ${events.description} ilike ${`%${options.q}%`})`
          : undefined,
        options.forYou
          ? or(eq(events.sport, options.forYou.sport), eq(events.city, options.forYou.city))
          : undefined,
        options.cursor
          ? isPast
            ? or(
                lt(events.startsAt, options.cursor.sortAt),
                and(eq(events.startsAt, options.cursor.sortAt), lt(events.id, options.cursor.id)),
              )
            : or(
                gt(events.startsAt, options.cursor.sortAt),
                and(eq(events.startsAt, options.cursor.sortAt), gt(events.id, options.cursor.id)),
              )
          : undefined,
      ),
    )
    .orderBy(isPast ? desc(events.startsAt) : asc(events.startsAt), isPast ? desc(events.id) : asc(events.id))
    .limit(options.limit + 1);

  const hasMore = rows.length > options.limit;
  const page = hasMore ? rows.slice(0, options.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.startsAt, last.eventId) : null;

  return {
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
      waitlistCount: row.waitlistCount,
      isWaitlisted: row.isWaitlisted,
      seriesId: row.seriesId,
    })),
    nextCursor,
  };
}

async function main() {
  await app.listen({ port, host: "0.0.0.0" });
}

void main();
