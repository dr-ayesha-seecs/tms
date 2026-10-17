/**
 * Host checks shared by the database and cookie code.
 * Netlify Functions (and Vercel) keep the deploy directory read-only; only /tmp can be written.
 */

/** True when the app directory cannot be written (serverless). Local `next dev` is false. */
export function isReadOnlyServerlessFs(): boolean {
  return Boolean(
    process.env.NETLIFY ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.VERCEL ||
      process.env.VERCEL_ENV
  );
}

export function isNetlify(): boolean {
  return Boolean(process.env.NETLIFY);
}

/**
 * Append to a Set-Cookie header. Production (including Netlify) is HTTPS.
 * Local `next dev` stays non-Secure so http://localhost still accepts the cookie.
 */
export function cookieSecureAttribute(): string {
  if (process.env.NODE_ENV === "production" || process.env.NETLIFY || process.env.VERCEL) {
    return "; Secure";
  }
  return "";
}
