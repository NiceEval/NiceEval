const state = { world: null, busy: false };
const $ = (selector) => document.querySelector(selector);

$("#world-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  await run(async () => {
    state.world = await api("/api/world", {
      method: "POST",
      body: { playerName: data.get("playerName"), topic: data.get("topic") },
    });
    $("#welcome").hidden = true;
    $("#game").hidden = false;
    $("#refresh").disabled = false;
    showFeed();
  }, "世界已生成");
});

$("#post-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  await run(async () => {
    state.world = await api("/api/posts", {
      method: "POST",
      body: { intent: data.get("intent"), withImage: data.get("withImage") === "on" },
    });
    form.reset();
    showFeed();
  }, "推文与后续互动已生成");
});

$("#refresh").addEventListener("click", () => run(async () => {
  state.world = await api("/api/feed/refresh", { method: "POST" });
  showFeed();
}, "时间线有了新动态"));

$("#my-profile").addEventListener("click", () => {
  if (state.world) showProfile(state.world.viewerId);
});

document.querySelector('[data-view="feed"]').addEventListener("click", () => {
  if (state.world) showFeed();
});

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

async function run(operation, success) {
  if (state.busy) return;
  state.busy = true;
  document.body.classList.add("busy");
  try {
    await operation();
    toast(success);
  } catch (error) {
    toast(error instanceof Error ? error.message : "操作失败");
  } finally {
    state.busy = false;
    document.body.classList.remove("busy");
  }
}

function showFeed() {
  const world = state.world;
  if (!world) return;
  $("#page-title").textContent = "为你推荐";
  $("#scenario").textContent = world.scenario;
  $("#world-signal").textContent = world.scenario;
  $("#mode-badge").textContent = world.providerMode === "fixture" ? "FIXTURE · 确定性离线" : "LIVE · 真实 API";
  $("#composer-avatar").src = world.profiles[world.viewerId].avatar.url;
  $("#post-form").hidden = false;
  $("#profile-view").hidden = true;
  $("#feed").hidden = false;
  renderPosts($("#feed"), world.posts);
  renderPeople();
}

async function showProfile(profileId) {
  await run(async () => {
    const result = await api(`/api/profiles/${encodeURIComponent(profileId)}`);
    const profile = result.profile;
    $("#page-title").textContent = profile.displayName;
    $("#scenario").textContent = `@${profile.handle}`;
    $("#post-form").hidden = true;
    $("#feed").hidden = true;
    const root = $("#profile-view");
    root.hidden = false;
    root.replaceChildren(profileCard(profile), postList(result.posts));
  }, "主页已打开");
}

function profileCard(profile) {
  const card = el("section", "profile-card");
  card.append(img(profile.banner.url, profile.banner.alt, "banner"));
  const body = el("div", "profile-body");
  body.append(img(profile.avatar.url, profile.avatar.alt, "profile-avatar"));
  body.append(textEl("h2", profile.displayName));
  body.append(textEl("span", `@${profile.handle}`));
  body.append(textEl("p", profile.bio));
  body.append(textEl("p", `⌖ ${profile.location}`));
  const stats = el("div", "stats");
  stats.append(stat(profile.followingCount, "正在关注"), stat(profile.followerCount, "关注者"));
  body.append(stats);
  card.append(body);
  return card;
}

function stat(value, label) {
  const span = el("span");
  const bold = textEl("b", compact(value));
  span.append(bold, ` ${label}`);
  return span;
}

function postList(posts) {
  const root = el("div");
  renderPosts(root, posts);
  return root;
}

function renderPosts(root, posts) {
  root.replaceChildren(...posts.map(postCard));
}

function postCard(post) {
  const world = state.world;
  const author = world.profiles[post.authorId];
  const article = el("article", "post");
  const avatar = img(author.avatar.url, author.avatar.alt, "avatar");
  avatar.addEventListener("click", () => showProfile(author.id));
  const content = el("div");
  if (post.kind !== "post") {
    const targetId = post.replyToId ?? post.repostOfId;
    const target = world.posts.find((candidate) => candidate.id === targetId);
    const targetAuthor = target ? world.profiles[target.authorId] : null;
    content.append(textEl("div", post.kind === "reply" ? `回复 @${targetAuthor?.handle ?? "unknown"}` : `转发 @${targetAuthor?.handle ?? "unknown"}`, "context"));
  }
  const head = el("div", "post-head");
  const name = textEl("span", author.displayName, "name");
  name.addEventListener("click", () => showProfile(author.id));
  head.append(name, textEl("span", `@${author.handle}`, "handle"), textEl("span", `· ${relative(post.createdAt)}`, "time"));
  content.append(head, textEl("p", post.content));
  if (post.image) content.append(img(post.image.url, post.image.alt, "post-image"));
  const actions = el("div", "actions");
  const replyButton = textEl("button", `↩ ${post.replyCount}`);
  replyButton.addEventListener("click", () => replyTo(post.id));
  const repost = textEl("span", `⟳ ${post.repostCount}`);
  const likes = textEl("span", `♡ ${post.likeCount}`);
  const imageButton = textEl("button", post.image ? "▧ 换图" : "▧ 配图");
  imageButton.addEventListener("click", () => addImage(post.id));
  actions.append(replyButton, repost, likes, imageButton);
  content.append(actions);
  article.append(avatar, content);
  return article;
}

async function replyTo(postId) {
  const intent = window.prompt("你想怎样回复？模型会据此生成最终回复。", "分享一个不同角度");
  if (!intent) return;
  await run(async () => {
    state.world = await api(`/api/posts/${encodeURIComponent(postId)}/replies`, { method: "POST", body: { intent } });
    showFeed();
  }, "回复与后续互动已生成");
}

async function addImage(postId) {
  const prompt = window.prompt("描述你想生成的配图（将发送到生图 provider）", "editorial social media image, cinematic lighting, no text");
  if (!prompt) return;
  await run(async () => {
    state.world = await api(`/api/posts/${encodeURIComponent(postId)}/image`, { method: "POST", body: { prompt } });
    showFeed();
  }, "配图已生成");
}

function renderPeople() {
  const root = $("#people");
  root.replaceChildren(...Object.values(state.world.profiles).map((profile) => {
    const item = el("div", "person");
    const copy = el("div");
    copy.append(textEl("strong", profile.displayName), textEl("span", `@${profile.handle}`));
    item.append(img(profile.avatar.url, profile.avatar.alt), copy);
    item.addEventListener("click", () => showProfile(profile.id));
    return item;
  }));
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function textEl(tag, value, className) {
  const node = el(tag, className);
  node.textContent = value;
  return node;
}

function img(src, alt, className) {
  const node = el("img", className);
  node.src = src;
  node.alt = alt;
  node.loading = "lazy";
  return node;
}

function compact(value) {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function relative(timestamp) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60_000));
  return minutes < 1 ? "刚刚" : minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时`;
}

let toastTimer;
function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 2600);
}
