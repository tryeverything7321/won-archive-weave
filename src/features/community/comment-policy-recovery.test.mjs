import assert from "node:assert/strict";
import test from "node:test";

let policyModule = {};
try {
  policyModule = await import("./comment-policy-recovery.ts");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

const requestedComments = [
  { postId: "post-1", commentId: "comment-owned" },
  { postId: "post-1", commentId: "comment-other" },
];

test("current ownership responses expose owned and hidden comments without leaking unrequested records", () => {
  assert.equal(typeof policyModule.parseCommunityOwnershipResponse, "function");

  const parsed = policyModule.parseCommunityOwnershipResponse({
    postIds: [],
    comments: [requestedComments[0]],
    hiddenPostIds: [],
    hiddenComments: [requestedComments[1]],
    canManageAll: false,
  }, { comments: requestedComments });

  assert.deepEqual(parsed, {
    postIds: [],
    comments: [requestedComments[0]],
    hiddenPostIds: [],
    hiddenComments: [requestedComments[1]],
    canManageAll: false,
    commentPolicy: "complete",
  });
  assert.throws(() => policyModule.parseCommunityOwnershipResponse({
    postIds: [],
    comments: [{ postId: "post-1", commentId: "not-requested" }],
    hiddenPostIds: [],
    hiddenComments: [],
    canManageAll: false,
  }, { comments: requestedComments }), /작성 권한 응답/);
});

test("legacy ownership without hiddenComments is a classified compatibility failure", () => {
  assert.equal(typeof policyModule.parseCommunityOwnershipResponse, "function");

  assert.throws(() => policyModule.parseCommunityOwnershipResponse({
      postIds: [],
      comments: [requestedComments[0]],
      canManageAll: false,
    }, { comments: requestedComments }), (error) =>
      error?.name === "CommunityOwnershipCompatibilityError" &&
      error?.code === "hidden-policy-missing");
});

test("malformed or incomplete current policy responses fail instead of becoming empty success", () => {
  assert.equal(typeof policyModule.parseCommunityOwnershipResponse, "function");

  assert.throws(() => policyModule.parseCommunityOwnershipResponse({
    postIds: [],
    comments: [requestedComments[0]],
    hiddenPostIds: [],
    hiddenComments: "none",
    canManageAll: false,
  }, { comments: requestedComments }), /숨김 정책 응답/);

  assert.throws(() => policyModule.parseCommunityOwnershipResponse({
    postIds: [],
    comments: [],
    canManageAll: false,
  }, { postIds: ["post-1"] }), /숨김 정책 응답/);
});

test("comment policy projection never renders comments without complete hidden policy", () => {
  assert.equal(typeof policyModule.projectCommentPolicy, "function");

  const comments = [
    { id: "comment-owned", body: "내 댓글" },
    { id: "comment-other", body: "다른 댓글" },
  ];
  assert.throws(() => policyModule.projectCommentPolicy(comments, {
    ownedCommentIds: new Set(["comment-owned"]),
    hiddenCommentIds: null,
  }), /숨김 정책 응답/);
  assert.deepEqual(
    policyModule.projectCommentPolicy(comments, {
      ownedCommentIds: new Set(["comment-owned"]),
      hiddenCommentIds: new Set(),
    }),
    { visibleComments: comments, policyIncomplete: false },
  );
  assert.deepEqual(
    policyModule.projectCommentPolicy(comments, {
      ownedCommentIds: new Set(["comment-owned"]),
      hiddenCommentIds: new Set(["comment-other"]),
    }),
    { visibleComments: [comments[0]], policyIncomplete: false },
  );
});

test("comment policy request generations change across accounts and comment snapshots", () => {
  assert.equal(typeof policyModule.commentPolicyRequestKey, "function");

  const first = policyModule.commentPolicyRequestKey("member-a", "post-1", requestedComments);
  assert.equal(first, policyModule.commentPolicyRequestKey("member-a", "post-1", [...requestedComments].reverse()));
  assert.notEqual(first, policyModule.commentPolicyRequestKey("member-b", "post-1", requestedComments));
  assert.notEqual(first, policyModule.commentPolicyRequestKey("member-a", "post-1", requestedComments.slice(0, 1)));
});
