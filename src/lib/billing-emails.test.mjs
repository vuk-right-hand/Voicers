// Run with: node --experimental-strip-types --test src/lib/billing-emails.test.mjs
// Node 22+ can strip TS types natively; otherwise compile first via `npx tsc`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPaymentFailedEmail,
  buildSubscriptionCanceledEmail,
} from "./billing-emails.ts";

const LOGIN = "https://voicers.vercel.app/login";

test("payment failed email — subject + key copy", () => {
  const { subject, html } = buildPaymentFailedEmail(LOGIN);
  assert.equal(
    subject,
    "Your Voicer payment didn't go through — 24 hours on us"
  );
  assert.match(html, /24 hours on us/);
  assert.match(html, /cancel automatically/);
  assert.match(html, /Update payment method/);
  assert.ok(html.includes(`href="${LOGIN}"`), "CTA must link to /login");
  assert.ok(!html.includes("/settings"), "should not link to /settings anymore");
});

test("subscription canceled email — subject + key copy", () => {
  const { subject, html } = buildSubscriptionCanceledEmail(LOGIN);
  assert.equal(
    subject,
    "Your Voicer subscription was canceled — 7 days to reactivate"
  );
  assert.match(html, /7 days/);
  assert.match(html, /Reactivate subscription/);
  assert.match(html, /cleaning up inactive data/);
  assert.ok(html.includes(`href="${LOGIN}"`), "CTA must link to /login");
});

test("both emails escape the login URL into the href exactly once", () => {
  const a = buildPaymentFailedEmail(LOGIN).html;
  const b = buildSubscriptionCanceledEmail(LOGIN).html;
  assert.equal((a.match(new RegExp(LOGIN, "g")) || []).length, 1);
  assert.equal((b.match(new RegExp(LOGIN, "g")) || []).length, 1);
});

test("loginUrl is substituted — different url produces different html", () => {
  const a = buildPaymentFailedEmail("https://a.test/login").html;
  const b = buildPaymentFailedEmail("https://b.test/login").html;
  assert.notEqual(a, b);
  assert.ok(a.includes("a.test/login"));
  assert.ok(b.includes("b.test/login"));
});
