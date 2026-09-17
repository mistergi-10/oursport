import cors from "@fastify/cors";
import Fastify from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { authenticate, AuthenticationError } from "./auth.js";
import { getDatabase } from "./db/client.js";
import { profiles, users } from "./db/schema.js";

const app = Fastify({ logger: true });
const port = Number(process.env.PORT ?? 10000);
const profileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  city: z.string().trim().min(1).max(120),
  sport: z.string().trim().min(1).max(40),
  level: z.string().trim().min(1).max(40),
});

app.register(cors, {
  origin: process.env.CORS_ORIGIN?.split(",") ?? true,
});

app.get("/health", async () => ({ status: "ok" }));

app.get("/ready", async (_request, reply) => {
  try {
    await getDatabase().execute("select 1");
    return { status: "ok", database: "ok" };
  } catch {
    return reply.code(503).send({ status: "error", database: "unavailable" });
  }
});

app.get("/v1/me", async (request, reply) => {
  const identity = await authenticate(request.headers);
  const database = getDatabase();
  const userId = await resolveUserId(identity.subject, identity.userId);

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
  const userId = identity.userId;

  if (!userId) {
    return reply.code(409).send({ error: "Profile setup requires a development user id" });
  }

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
    })
    .onConflictDoUpdate({
      target: profiles.userId,
      set: {
        displayName: body.name,
        city: body.city,
        sport: body.sport,
        level: body.level,
        updatedAt: new Date(),
      },
    })
    .returning();

  return reply.code(201).send(toProfileResponse(profile));
});

app.patch("/v1/me", async (request, reply) => {
  const identity = await authenticate(request.headers);
  const body = profileSchema.parse(request.body);
  const database = getDatabase();
  const userId = identity.userId;

  if (!userId) {
    return reply.code(409).send({ error: "Profile update requires a development user id" });
  }

  const [profile] = await database
    .update(profiles)
    .set({
      displayName: body.name,
      city: body.city,
      sport: body.sport,
      level: body.level,
      updatedAt: new Date(),
    })
    .where(eq(profiles.userId, userId))
    .returning();

  if (!profile) return reply.code(404).send({ error: "Profile not found" });
  return toProfileResponse(profile);
});

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

async function resolveUserId(subject: string, developmentUserId?: string) {
  if (developmentUserId) return developmentUserId;

  const [user] = await getDatabase()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.authSubject, subject));
  if (!user) throw new AuthenticationError("User is not registered");
  return user.id;
}

function toProfileResponse(profile: typeof profiles.$inferSelect) {
  return {
    name: profile.displayName,
    city: profile.city,
    sport: profile.sport,
    level: profile.level,
  };
}

async function main() {
  await app.listen({ port, host: "0.0.0.0" });
}

void main();
