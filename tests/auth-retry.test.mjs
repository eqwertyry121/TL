import assert from "node:assert/strict";
import test from "node:test";

import { createSingleFlightAuthRetry, isAuthErrorLike } from "../packages/api-client/src/auth-retry.ts";

test("single-flight auth retry shares one authenticate call across concurrent auth failures", async () => {
  let authenticateCalls = 0;
  let releaseAuth;
  const retry = createSingleFlightAuthRetry({
    authenticate: () => {
      authenticateCalls += 1;
      return new Promise((resolve) => {
        releaseAuth = () => resolve("fresh-token");
      });
    },
    isAuthError: isAuthErrorLike,
  });
  const seenTokens = [];
  const action = async (token) => {
    seenTokens.push(token);
    if (token === "expired-token") {
      throw { status: 401 };
    }
    return `ok:${token}`;
  };

  const first = retry.withAuth(action, "expired-token");
  const second = retry.withAuth(action, "expired-token");
  await Promise.resolve();

  assert.equal(authenticateCalls, 1, "concurrent auth failures must share one authenticate request");
  releaseAuth();

  assert.deepEqual(await Promise.all([first, second]), ["ok:fresh-token", "ok:fresh-token"]);
  assert.deepEqual(seenTokens, ["expired-token", "expired-token", "fresh-token", "fresh-token"]);
});

test("single-flight auth retry does not retry non-auth errors", async () => {
  let authenticateCalls = 0;
  const retry = createSingleFlightAuthRetry({
    authenticate: async () => {
      authenticateCalls += 1;
      return "fresh-token";
    },
    isAuthError: isAuthErrorLike,
  });

  await assert.rejects(
    () => retry.withAuth(async () => {
      throw Object.assign(new Error("boom"), { status: 500 });
    }, "current-token"),
    /boom/,
  );
  assert.equal(authenticateCalls, 0);
});

test("single-flight auth retry retries at most once for an auth error", async () => {
  let authenticateCalls = 0;
  let actionCalls = 0;
  const retry = createSingleFlightAuthRetry({
    authenticate: async () => {
      authenticateCalls += 1;
      return "fresh-token";
    },
    isAuthError: isAuthErrorLike,
  });

  await assert.rejects(
    () => retry.withAuth(async () => {
      actionCalls += 1;
      throw { code: "AUTH_INVALID" };
    }, "expired-token"),
  );
  assert.equal(authenticateCalls, 1);
  assert.equal(actionCalls, 2);
});
