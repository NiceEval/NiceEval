import { closedQA, equals } from "niceeval/expect";
import { x } from "../evaluation/adapter.js";
import { attachedImage, authoredPost, authoredReply, imageMaterial } from "../evaluation/matches.js";

export default x.defineScoreEval({
  description: "城市夜生活：发现页、发帖意图、AI 回应上下文与人物一致性，共 100 分",
  judge: true,
  async test(t) {
    const world = await t.visitDiscoveryPage();
    // Score Eval 的普通检查不改变 Verdict；orStop 显式阻止无效材料继续进入 rubric。
    await t.check(world.providerMode, equals("live")).label("必须使用真实 provider").orStop();
    t.check({
      input: `主题：${world.scenario}。人物：${JSON.stringify(Object.values(world.profiles).map(({ displayName, bio }) => ({ displayName, bio })))}`,
      output: world.posts.map((post) => `${world.profiles[post.authorId]!.displayName}：${post.content}`).join("\n"),
    }, closedQA("这些中文动态是否围绕城市夜生活，包含具体细节和不同观点，读起来自然，没有重复的万能套话？"))
      .score(25).label("发现页相关性与多样性");

    const intent = "邀请大家今晚一起拍摄城市夜景，明确在河边步道入口集合，不要擅自编造具体时间";
    const post = await t.post({ intent, withImage: false });
    await t.check(post, authoredPost(world.viewerId)).label("发布结果有效").orStop();
    t.check({ input: intent, output: post.content },
      closedQA("推文是否保留邀请、今晚拍摄城市夜景、河边步道入口集合这三个要点，且没有擅自编造具体时间？"))
      .score(25).label("发帖遵循意图");

    const replyIntent = "补充下雨就取消，提醒大家出发前看天气";
    const reply = await t.reply({ postId: post.id, intent: replyIntent });
    await t.check(reply, authoredReply(world.viewerId, post.id)).label("回复结果有效").orStop();
    // 用户回复直接保存原文；不能为这段非模型输出贡献模型质量分。
    await t.check(reply.content, equals(replyIntent)).label("用户回复原文保存").orStop();

    const responses = await t.waitForReplies(reply.id);
    const responseMaterial = {
      input: JSON.stringify({ post: post.content, reply: reply.content, characters: responses.map((item) => {
        const profile = world.profiles[item.authorId]!;
        return { name: profile.displayName, bio: profile.bio };
      }) }),
      output: responses.map((item) => `${world.profiles[item.authorId]!.displayName}：${item.content}`).join("\n"),
    };
    t.check(responseMaterial,
      closedQA("人物回复是否直接回应本次夜拍活动或下雨取消安排，提供具体且相关的信息，没有误解用户安排，也没有重复的万能赞同或无关追问？"))
      .score(25).label("AI 回应遵循上下文");
    t.check(responseMaterial,
      closedQA("每位人物的回应是否与给定简介相容，并体现各自的关注点或表达差异，而不是所有人都给出可互换的同质套话？"))
      .score(25).label("AI 回应人物一致性");

    // 图片存在仅是生成协议事实，不给视觉质量加分，也不把 URL/alt 交给文本 Judge 假装看图。
    t.check(imageMaterial(world.profiles[world.viewerId]!.avatar), attachedImage("live"))
      .label("真实生图结果存在（非视觉评分）");
  },
});
