import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let redis: Redis | null = null;

function getRedis() {
  if (!redis) {
    redis = Redis.fromEnv();
  }
  return redis;
}

/** 3 emails per hour per user */
export const emailRatelimit = new Ratelimit({
  redis: getRedis(),
  limiter: Ratelimit.slidingWindow(3, "1 h"),
  prefix: "rl:email",
});
