import { equals, satisfies } from "niceeval/expect";
import { x } from "../evaluation/adapter.js";
import {
  characterConsistency,
  discoveryDiversity,
  discoveryRelevance,
  followsPostIntent,
  responseContextQuality,
} from "../evaluation/judges.js";
import { attachedImage, authoredPost, authoredReply, imageMaterial } from "../evaluation/matches.js";

export default x.defineScoreEval({
  description: "城市夜生活：发现页相关性与多样性、发帖意图、AI 回应上下文与人物一致性，共 100 分",
  async test(t) {
    const world = await t.visitDiscoveryPage();
    // 前置条件既是质量门，也阻止无效材料继续进入 rubric。
    await t.check(world.providerMode, equals("live")).gate().label("必须使用真实 provider").orStop();
    await t.check(world.posts.length, satisfies("发现页至少包含 4 条初始动态", (count) => count >= 4))
      .gate()
      .label("发现页材料非空")
      .orStop();
    const discoveryMaterial = {
      scenario: world.scenario,
      posts: world.posts.map((item) => ({
        author: world.profiles[item.authorId]!.displayName,
        content: item.content,
      })),
    };
    t.judge(discoveryMaterial, discoveryRelevance).score(20).label("发现页相关性");
    t.judge(discoveryMaterial, discoveryDiversity).score(15).label("发现页多样性");

    const instructions = ["邀请大家今晚一起拍摄城市夜景", "明确在河边步道入口集合", "不要擅自编造具体时间"];
    const intent = instructions.join("，");
    const post = await t.post({ intent, withImage: false });
    await t.check(post, authoredPost(world.viewerId)).gate().label("发布结果有效").orStop();
    t.check({ instructions, output: post.content }, followsPostIntent)
      .score(25).label("发帖遵循意图");

    const replyIntent = "补充下雨就取消，提醒大家出发前看天气";
    const reply = await t.reply({ postId: post.id, intent: replyIntent });
    await t.check(reply, authoredReply(world.viewerId, post.id)).gate().label("回复结果有效").orStop();
    // 用户回复直接保存原文；不能为这段非模型输出贡献模型质量分。
    await t.check(reply.content, equals(replyIntent)).gate().label("用户回复原文保存").orStop();

    const responses = await t.waitForReplies(reply.id);
    await t.check(responses.length, satisfies("至少生成 1 条人物回复", (count) => count >= 1))
      .gate()
      .label("人物回复材料非空")
      .orStop();
    const characterReplies = responses.map((item) => {
      const profile = world.profiles[item.authorId]!;
      return { character: profile.displayName, bio: profile.bio, reply: item.content };
    });
    t.judge({ post: post.content, userReply: reply.content, characterReplies }, responseContextQuality)
      .score(20).label("AI 回应遵循上下文");
    t.judge({ characters: characterReplies }, characterConsistency)
      .score(20).label("AI 回应人物一致性");

    // 图片存在仅是生成协议事实，不给视觉质量加分，也不把 URL/alt 交给文本 Judge 假装看图。
    t.check(imageMaterial(world.profiles[world.viewerId]!.avatar), attachedImage("live"))
      .label("真实生图结果存在（非视觉评分）");
  },
});
