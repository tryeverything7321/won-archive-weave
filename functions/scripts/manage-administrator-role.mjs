#!/usr/bin/env node

import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const projectId = "won-archive-weave";
const [action, uid, confirmation] = process.argv.slice(2);
const supportedActions = new Set(["status", "grant", "revoke"]);

function printUsage() {
  console.log([
    "사용법",
    "  node scripts/manage-administrator-role.mjs status <FIREBASE_UID>",
    "  node scripts/manage-administrator-role.mjs grant <FIREBASE_UID> --confirm",
    "  node scripts/manage-administrator-role.mjs revoke <FIREBASE_UID> --confirm",
  ].join("\n"));
}

if (!supportedActions.has(action) || !uid) {
  printUsage();
  process.exitCode = 1;
} else if (action !== "status" && confirmation !== "--confirm") {
  console.error("권한 변경에는 마지막 인자로 --confirm이 필요합니다");
  process.exitCode = 1;
} else {
  initializeApp({
    credential: applicationDefault(),
    projectId,
  });

  const auth = getAuth();
  const user = await auth.getUser(uid);
  const currentClaims = user.customClaims ?? {};

  if (action === "status") {
    console.log(JSON.stringify({
      projectId,
      uid: user.uid,
      role: currentClaims.role ?? null,
      administrator: currentClaims.role === "administrator",
    }, null, 2));
  } else {
    const nextClaims = { ...currentClaims };

    if (action === "grant") {
      nextClaims.role = "administrator";
    } else {
      delete nextClaims.role;
    }

    await auth.setCustomUserClaims(uid, nextClaims);
    await auth.revokeRefreshTokens(uid);
    await getFirestore().collection("auditEvents").add({
      type: action === "grant" ? "administrator.granted" : "administrator.revoked",
      targetUid: uid,
      source: "manage-administrator-role",
      at: FieldValue.serverTimestamp(),
    });
    console.log(JSON.stringify({
      projectId,
      uid: user.uid,
      role: nextClaims.role ?? null,
      administrator: nextClaims.role === "administrator",
      refreshTokensRevoked: true,
      nextStep: "위브에서 로그아웃한 뒤 다시 로그인해 새 ID 토큰을 발급받으세요",
    }, null, 2));
  }
}
