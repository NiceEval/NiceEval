import { defineJudge, instructionFollowing } from "niceeval";

export const discoveryRelevance = defineJudge({
  name: "discovery-relevance",
  rubric: "评价 posts 是否围绕 scenario 展开，并以具体、自然的中文内容呈现城市夜生活。",
  anchors: [
    { measurement: 0, description: "多数内容偏离主题、空泛或无法理解" },
    { measurement: 0.5, description: "内容大体相关，但具体细节或自然度不足" },
    { measurement: 1, description: "全部内容紧扣主题，包含具体细节且表达自然" },
  ],
});

export const discoveryDiversity = defineJudge({
  name: "discovery-diversity",
  rubric: "评价 posts 是否呈现不同人物的观点与关注点，避免重复万能套话。",
  anchors: [
    { measurement: 0, description: "内容高度重复，人物观点几乎可以互换" },
    { measurement: 0.5, description: "有部分观点差异，但仍有明显重复或同质表达" },
    { measurement: 1, description: "观点和关注点清楚区分，没有重复万能套话" },
  ],
});

export const followsPostIntent = instructionFollowing({ name: "follows-post-intent" });

export const responseContextQuality = defineJudge({
  name: "response-context-quality",
  rubric: "根据 post 与 userReply 评价 characterReplies 是否直接回应夜拍活动和下雨取消安排，并提供相关信息。",
  anchors: [
    { measurement: 0, description: "回复误解或忽略活动与下雨取消安排，内容无关" },
    { measurement: 0.5, description: "回复理解主要上下文，但遗漏一项安排或只有泛泛回应" },
    { measurement: 1, description: "回复准确回应活动与取消条件，并给出具体相关信息" },
  ],
});

export const characterConsistency = defineJudge({
  name: "character-consistency",
  rubric: "根据 characters[].character 与 characters[].bio，评价对应 characters[].reply 是否符合人物，并体现可区分的关注点或表达方式。",
  anchors: [
    { measurement: 0, description: "回复与人物简介冲突，或所有人物都是可互换的同质套话" },
    { measurement: 0.5, description: "回复大体不冲突，但只有部分人物体现自身关注点" },
    { measurement: 1, description: "每条回复都符合人物简介，并清楚体现各自不同的关注点或表达方式" },
  ],
});
