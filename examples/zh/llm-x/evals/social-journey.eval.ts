import { equals, greaterThan, satisfies } from "niceeval/expect";
import { x } from "../evaluation/application.js";
import {
  attachedImage,
  authoredPost,
  authoredReply,
  coherentSocialWorld,
  imageMaterial,
  profileMaterial,
  worldMaterial,
} from "../evaluation/matches.js";

export default x.defineEval({
  description: "人物主页、带图发帖、回复和后续时间线保持同一个社交世界",
  async test(t) {
    const initial = t.visitDiscoveryPage();
    const initialPostIds = new Set(initial.posts.map((post) => post.id));
    const viewer = t.viewProfile(initial.viewerId);
    t.check(worldMaterial(initial), coherentSocialWorld()).label("初始世界关系完整");
    t.check(viewer.profile.isViewer, equals(true)).label("主页属于当前玩家");
    t.check(imageMaterial(viewer.profile.avatar), attachedImage(initial.providerMode)).label("人物头像存在");
    t.check(imageMaterial(viewer.profile.banner), attachedImage(initial.providerMode)).label("主页横幅存在");

    const post = await t.post({ intent: "邀请大家今晚一起拍摄城市夜景", withImage: true });
    t.check(post, authoredPost(initial.viewerId)).label("直接匹配应用返回的 Post");
    t.check(imageMaterial(post.image), attachedImage(initial.providerMode)).label("发帖动作生成配图");
    t.check(worldMaterial(t.visitDiscoveryPage()), coherentSocialWorld()).label("生成互动的引用与计数正确");

    const reply = await t.reply({ postId: post.id, intent: "补充集合地点在河边步道入口" });
    t.check(reply, authoredReply(initial.viewerId, post.id)).label("回复绑定原推文");
    const replied = t.visitDiscoveryPage();

    const refreshed = await t.refreshFeed();
    t.check(refreshed.posts.length, greaterThan(replied.posts.length)).label("刷新生成新的动态");
    t.check(worldMaterial(refreshed), coherentSocialWorld()).label("刷新后社交关系仍完整");
    t.check(profileMaterial(t.viewProfile(initial.viewerId).profile), equals(profileMaterial(viewer.profile)))
      .label("后续互动保持玩家身份");

    const image = await t.generateImage({
      postId: reply.id,
      prompt: "An editorial photograph of a riverside meeting point at blue hour, no text",
    });
    const illustrated = t.visitDiscoveryPage();
    const illustratedReply = illustrated.posts.find((item) => item.id === reply.id);
    if (!illustratedReply) throw new Error("Image generation lost the target reply.");
    t.check(imageMaterial(image), attachedImage(initial.providerMode)).label("独立生图返回图片");
    t.check(illustratedReply.image, equals(image)).label("生成图片附着到指定回复");
    t.check(illustratedReply, authoredReply(initial.viewerId, post.id)).label("补图保留回复正文与关系");
    t.check(illustratedReply.content, equals(reply.content)).label("补图不改写正文");
    t.check(illustrated.posts.map((item) => item.id), satisfies<string[]>(
      "保留初始推文",
      (ids) => [...initialPostIds].every((id) => ids.includes(id)),
    )).label("多步操作保留已有内容");
  },
});
