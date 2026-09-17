import { jwtVerify, SignJWT } from "jose";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AuthenticationError extends Error {
  statusCode = 401;
}

export async function issueToken(subject: string) {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) throw new Error("AUTH_JWT_SECRET is not configured");
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(new TextEncoder().encode(secret));
}

export async function authenticate(headers: {
  authorization?: string | string[];
  "x-user-id"?: string | string[];
}) {
  const authorization = Array.isArray(headers.authorization)
    ? headers.authorization[0]
    : headers.authorization;
  const secret = process.env.AUTH_JWT_SECRET;

  if (authorization?.startsWith("Bearer ") && secret) {
    try {
      const { payload } = await jwtVerify(
        authorization.slice("Bearer ".length),
        new TextEncoder().encode(secret),
      );
      if (typeof payload.sub === "string" && payload.sub.length > 0) {
        return { subject: payload.sub };
      }
    } catch {
      throw new AuthenticationError("Invalid bearer token");
    }
  }

  if (process.env.NODE_ENV !== "production") {
    const developmentUserId = Array.isArray(headers["x-user-id"])
      ? headers["x-user-id"][0]
      : headers["x-user-id"];
    if (developmentUserId && uuidPattern.test(developmentUserId)) {
      return { subject: `dev:${developmentUserId}`, userId: developmentUserId };
    }
  }

  throw new AuthenticationError("Authentication required");
}