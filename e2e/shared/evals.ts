// e2e 共享 eval 套件:全部是参数化 factory,单一事实来源(见 docs/engineering/e2e-ci/README.md 第 3 节)。
// 断言逻辑改这里、全矩阵生效;各 SDK 的协议差异(工具名、usage、HITL 支持)只从 profile 进来。
// 提示词纪律沿用 tier1 的教训:不提"审批"二字(有的模型会改用文字反问而不发起工具调用),
// 对 coding agent 显式说明"不用跑命令"(否则纯问答也可能顺手探索工作目录)。
import { defineEval } from "niceeval";
import { equals, includes, excludes } from "niceeval/expect";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentProfile } from "./profile.ts";

/** 正常问答 + 反调:不该动任何工具(coding agent 放宽为"没有失败的动作")。 */
export function basicQa(p: AgentProfile) {
  return defineEval({
    description: "正常问答;非 coding agent 兼验证不瞎调工具(反调)",
    async test(t) {
      const prompt = p.sandboxTools
        ? "1+1 等于几?用一句话回答就好,不用跑命令也不用建文件。"
        : "用一句话介绍一下你自己,这轮不用查天气也不用算数。";
      const turn = await t.send(prompt);
      turn.expectOk();
      t.succeeded();

      if (p.sandboxTools) {
        // Codex 这类自主编码 agent 即使纯问答也可能顺手探索目录,不强断言零工具。
        t.noFailedActions();
        t.messageIncludes("2");
      } else {
        t.usedNoTools();
        if (p.weatherToolName) t.notCalledTool(p.weatherToolName);
        t.judge.autoevals.closedQA("助手是否用一两句话正常介绍了自己,而不是报错或答非所问?").gate(0.6);
      }

      // 上限按 agent 形态分档:coding CLI(claude-code 等)单轮自带巨大系统提示词与工具定义,
      // 一句"1+1"实测就 ~47k tok(含 cache read),40k 会把正常行为误判红;80k 仍然拦得住
      // 失控的多轮循环。非 coding agent 保持 40k。
      if (p.usage) t.maxTokens(p.sandboxTools ? 80_000 : 40_000);
    },
  });
}

/** 正调:天气提问必须触发天气工具且城市参数正确;顺带反调计算器。 */
export function weatherTool(p: AgentProfile) {
  if (!p.weatherToolName) throw new Error("weatherTool eval requires profile.weatherToolName");
  const weather = p.weatherToolName;
  return defineEval({
    description: "天气提问正确调用天气工具并基于结果作答(正调)",
    async test(t) {
      const turn = await t.send("北京今天天气怎么样?");
      turn.expectOk();

      await t.group("调用天气工具且城市正确", () => {
        // city 用正则:模型传 "北京市" 也算对,别把语言习惯差异判成回归。
        t.calledTool(weather, { input: { city: /北京/ } });
        t.messageIncludes(/°C|气温|天气|晴|多云|雨|阴/);
      });
      if (p.calcToolName) t.notCalledTool(p.calcToolName);

      t.judge.autoevals
        .closedQA("助手是否给出了具体的天气数据(温度或天气状况),而不是拒绝回答或含糊其辞?")
        .atLeast(0.7);
    },
  });
}

/** 正调:查资料提问触发搜索工具且 query 沾题;顺带反调天气。只有注册了搜索工具的应用才排。 */
export function webSearch(p: AgentProfile) {
  if (!p.searchToolName) throw new Error("webSearch eval requires profile.searchToolName");
  const search = p.searchToolName;
  return defineEval({
    description: "查资料提问触发搜索工具并基于结果作答(正调)",
    async test(t) {
      const turn = await t.send("帮我搜一下「niceeval」这个词,用一两句话告诉我搜到了什么。");
      turn.expectOk();

      await t.group("调用搜索工具且 query 沾题", () => {
        t.calledTool(search, { input: { query: /niceeval/i } });
        t.messageIncludes(/niceeval/i);
      });
      if (p.weatherToolName) t.notCalledTool(p.weatherToolName);
    },
  });
}

/** 多步工具链:比较两个城市要两次天气调用,凭一次调用答不出。断言只锚定"确实各查了一次",
 *  哪个城市更热由各应用的 mock 数据决定,不在共享层写死。 */
export function weatherCompare(p: AgentProfile) {
  if (!p.weatherToolName) throw new Error("weatherCompare eval requires profile.weatherToolName");
  const weather = p.weatherToolName;
  return defineEval({
    description: "两城市天气比较:同一轮里发起两次天气调用再作答(多步工具链)",
    async test(t) {
      const turn = await t.send("北京和上海今天哪个更热?分别查一下再回答。");
      turn.expectOk();

      await t.group("两个城市各查了一次", () => {
        t.calledTool(weather, { input: { city: /北京/ } });
        t.calledTool(weather, { input: { city: /上海/ } });
      });
      t.messageIncludes(/北京/);
      t.messageIncludes(/上海/);
      if (p.calcToolName) t.notCalledTool(p.calcToolName);
    },
  });
}

/** HITL 批准分支:approve 之后工具正常执行,status 是 "completed"。 */
export function hitlApprove(p: AgentProfile) {
  if (!p.calcToolName) throw new Error("hitlApprove eval requires profile.calcToolName");
  const calc = p.calcToolName;
  return defineEval({
    description: "HITL:计算器经批准后正常执行",
    async test(t) {
      const draft = await t.send("用计算器算一下 (23+19)*3 等于多少");
      t.check(draft.status, equals("waiting"));
      // 反证门控真拦住了执行:批准前不允许出现计算器的"已完成"结果,否则"先执行、
      // 事后补问审批"的实现也能骗过下面的正向断言。注意不能用 notCalledTool
      // (status:"completed"):派生事实对"已发起还没结果"的调用乐观默认 completed,
      // 只有对原始事件流查 action.result 才能表达"还没执行"。
      draft.eventsSatisfy((events) => {
        const calcIds = new Set(
          events.filter((e) => e.type === "action.called" && e.name === calc).map((e) => e.callId),
        );
        return !events.some(
          (e) => e.type === "action.result" && calcIds.has(e.callId) && e.status === "completed",
        );
      }, "no completed calculator result before approval");

      t.requireInputRequest({ action: calc });

      const approved = await t.respond("approve");
      approved.succeeded();
      t.calledTool(calc, { status: "completed" });
      t.messageIncludes(/126/);
    },
  });
}

/** HITL 拒绝分支:人否决落 "rejected" 而不是 "failed";模型不死心重试时 deny 到放弃为止。 */
export function hitlDeny(p: AgentProfile) {
  if (!p.calcToolName) throw new Error("hitlDeny eval requires profile.calcToolName");
  const calc = p.calcToolName;
  return defineEval({
    description: "HITL:计算器被拒绝后标记 rejected 而不是 failed",
    async test(t) {
      await t.send("用计算器算一下 (23+19)*3 等于多少");
      t.requireInputRequest({ action: calc });

      let denied = await t.respond("deny");
      for (let attempt = 0; attempt < 3 && denied.status === "waiting"; attempt++) {
        denied = await t.respond("deny");
      }
      t.check(denied.status, equals("completed"));
      t.calledTool(calc, { status: "rejected" });
      // deny 的核心语义是"从未真正执行":只断言"存在 rejected"拦不住"照跑了但补标
      // rejected"的坏实现,必须整个会话里都没有已完成的计算器调用。
      t.notCalledTool(calc, { status: "completed" });
      t.noFailedActions();
    },
  });
}

/** 工具执行失败被如实标记 failed:7/0 每个 app 的 calculate 都必然报错,协议层不许吞成
 *  completed,也不许炸掉整轮;模型看到错误要如实作答而不是编造数字。计算器经审批门控,
 *  所以走一次 approve 才能触发真实执行。 */
export function toolFailure(p: AgentProfile) {
  if (!p.calcToolName) throw new Error("toolFailure eval requires profile.calcToolName");
  const calc = p.calcToolName;
  return defineEval({
    description: "工具执行失败映射成 failed 状态,agent 恢复作答而不是编造结果",
    async test(t) {
      await t.send("用计算器算一下 7/0,把表达式原样交给工具;如果工具报错,不要换别的表达式重试,直接告诉我失败原因。");
      t.requireInputRequest({ action: calc });

      let turn = await t.respond("approve");
      // 模型不听话重试新表达式时会再次触发审批:deny 到它放弃为止,保证最终收轮。
      for (let attempt = 0; attempt < 3 && turn.status === "waiting"; attempt++) {
        turn = await t.respond("deny");
      }
      t.check(turn.status, equals("completed"));

      await t.group("失败如实落 failed,没有成功执行混进来", () => {
        t.calledTool(calc, { status: "failed" });
        t.notCalledTool(calc, { status: "completed" });
      });

      t.judge.autoevals
        .closedQA("助手是否如实说明这次计算失败或无法计算(除以零),而没有编造一个具体的数值结果?")
        .gate(0.6);
    },
  });
}

/** 跨轮记忆两半承诺:同一会话线记得住,newSession() 不共享历史。纯口头事实,不受磁盘状态干扰。 */
export function sessionIsolation(p: AgentProfile) {
  const suffix = p.sandboxTools ? "这轮不用跑命令也不用建文件。" : "";
  return defineEval({
    description: "跨轮记忆与 newSession() 隔离",
    async test(t) {
      (await t.send(`我叫小明,帮我记住这个名字。${suffix}`)).expectOk();
      const recall = await t.send(`我刚才说我叫什么名字?${suffix}`);
      recall.expectOk();
      recall.messageIncludes("小明");

      // 反面半场必须先证明这一轮真的跑成了:没有 expectOk 的话,新会话直接报错、
      // 回复是空串,excludes 对空串恒真,"隔离通过"就成了空洞结论。
      const fresh = t.newSession();
      const freshTurn = await fresh.send(`我叫什么名字?${suffix}`);
      freshTurn.expectOk();
      if (p.persistentMemory) {
        // claude-code 这类 agent 有产品级磁盘记忆:第一轮的"帮我记住"会让它把名字写进
        // memory 文件,newSession 后的全新会话按设计重新加载 memory,"合法地"知道名字
        // (实测两次尝试都如此,见 memory/claude-code-persistent-memory-breaks-verbal-isolation.md)。
        // 口头反证对它不成立,也不该成立——那是 agent 的正确行为,不是隔离失效。
        // 真正要测的是 resume 管线:resumed 轮的 transcript 会回放历史(上一轮就带着
        // 第一轮原文),全新会话的 transcript 不该出现第一轮的用户原文。
        const replayed = freshTurn.events.some(
          (e) => e.type === "message" && e.role === "user" && e.text.includes("我叫小明"),
        );
        t.check(replayed, equals(false));
      } else {
        t.check(fresh.reply, excludes("小明"));
      }
    },
  });
}

/** coding agent 本分:在工作目录里写一个真实文件,跑完双重核实(host 读磁盘 / sandbox 读 diff)。 */
export function createFile(p: AgentProfile) {
  if (!p.sandboxTools) throw new Error("createFile eval requires profile.sandboxTools");
  const useSandboxFs = p.workspace === "sandbox";
  if (!useSandboxFs && !p.workspaceDir) {
    throw new Error('createFile eval requires profile.workspaceDir (host mode) or profile.workspace: "sandbox"');
  }
  const relPath = "niceeval-e2e-create-file.txt";
  const marker = "niceeval-e2e-marker-926";
  const hostTarget = useSandboxFs ? undefined : join(p.workspaceDir!, relPath);
  return defineEval({
    description: "在工作目录里创建一个内容正确的真实文件",
    async test(t) {
      // sandbox 模式每个 attempt 都是全新容器(见 src/runner/sandbox-prep.ts 的 git 基线),
      // 不需要跑前清理;host 模式复用同一份宿主目录,必须先清掉上次跑剩的文件。
      if (hostTarget) rmSync(hostTarget, { force: true });

      const turn = await t.send(
        `在当前工作目录创建一个文件 niceeval-e2e-create-file.txt,内容只写一行:${marker}`,
      );
      turn.expectOk();
      t.succeeded();
      t.noFailedActions();

      if (useSandboxFs) {
        t.sandbox.fileChanged(relPath);
        t.check(t.sandbox.file(relPath), includes(marker));
      } else {
        // 文件不存在按空内容断言:"没写出文件"是这条 eval 要测的 failed,不是框架 errored。
        const content = existsSync(hostTarget!) ? readFileSync(hostTarget!, "utf8") : "";
        t.check(content, includes(marker));
      }
    },
  });
}

/** coding agent 修改既有文件:精确替换一行、不动其余内容,跑完双重核实。
 *  和 createFile 的"从无到有"互补,盖住 apply_patch / 编辑类动作的协议路径。 */
export function modifyFile(p: AgentProfile) {
  if (!p.sandboxTools) throw new Error("modifyFile eval requires profile.sandboxTools");
  const useSandboxFs = p.workspace === "sandbox";
  if (!useSandboxFs && !p.workspaceDir) {
    throw new Error('modifyFile eval requires profile.workspaceDir (host mode) or profile.workspace: "sandbox"');
  }
  const relPath = "niceeval-e2e-modify-file.txt";
  const oldMarker = "niceeval-e2e-old-926";
  const newMarker = "niceeval-e2e-new-926";
  const hostTarget = useSandboxFs ? undefined : join(p.workspaceDir!, relPath);
  const seed = `alpha\n${oldMarker}\nomega\n`;
  return defineEval({
    description: "修改工作目录里的既有文件:替换目标行且不动其余内容",
    async test(t) {
      if (useSandboxFs) {
        await t.sandbox.writeFiles({ [relPath]: seed });
      } else {
        writeFileSync(hostTarget!, seed);
      }

      const turn = await t.send(
        `把当前工作目录里 niceeval-e2e-modify-file.txt 中的 ${oldMarker} 改成 ${newMarker},其它内容保持不变。`,
      );
      turn.expectOk();
      t.succeeded();
      t.noFailedActions();

      const content = useSandboxFs
        ? t.sandbox.file(relPath)
        : existsSync(hostTarget!)
          ? readFileSync(hostTarget!, "utf8")
          : "";
      await t.group("目标行换了,其余行原样", () => {
        t.check(content, includes(newMarker));
        t.check(content, excludes(oldMarker));
        t.check(content, includes("alpha"));
        t.check(content, includes("omega"));
      });
    },
  });
}

/**
 * coding agent 真的跑 shell 命令(而不是凭空回答)。断言用规范化后的 `"shell"` 类目而不是
 * 某一家的原始工具名:codex 原始名恰好就是 `command_execution`,但 claude-code 原始名是
 * `Bash`——`calledTool` 同时比较规范名与原始名(见 `src/scoring/scoped.ts` 的 toolMatches),
 * `"shell"` 是两家都会规范化到的那个规范名,断言逻辑因此不用按 SDK 分支。
 */
export function runCommand(p: AgentProfile) {
  if (!p.sandboxTools) throw new Error("runCommand eval requires profile.sandboxTools");
  return defineEval({
    description: "在工作目录里跑一个真实 shell 命令",
    async test(t) {
      const turn = await t.send("在当前工作目录跑 `echo niceeval-e2e-run-926`,把命令的输出告诉我。");
      turn.expectOk();

      await t.group("调用了 shell 且没有失败的动作", () => {
        // marker 就写在提示词里,光看回复文本分不清"真跑了"和"照抄提示词"——
        // 必须对到 command 入参:确实执行过带这个 marker 的命令。
        t.calledTool("shell", { status: "completed", input: { command: /niceeval-e2e-run-926/ } });
        t.noFailedActions();
      });

      t.messageIncludes("niceeval-e2e-run-926");
    },
  });
}

/**
 * 沙箱冒烟:让 agent 建一个指定内容的文件,验证"沙箱起得来、agent 装得上、transcript 读得回"——
 * 不考模型能力,提示词简单到几乎不可能失败(docs/engineering/e2e-ci/README.md §4.2 对 sandbox-smoke 的原始要求)。
 */
export function sandboxSmoke(p: AgentProfile) {
  if (!p.sandboxTools) throw new Error("sandboxSmoke eval requires profile.sandboxTools");
  const relPath = "niceeval-smoke.txt";
  const marker = "niceeval-e2e-sandbox-smoke-926";
  return defineEval({
    description: "沙箱冒烟:创建一个内容正确的文件(几乎不可能失败的提示词)",
    async test(t) {
      const turn = await t.send(`Create a file named ${relPath} in the current directory with exactly one line: ${marker}`);
      turn.expectOk();
      t.succeeded();
      t.sandbox.fileChanged(relPath);
      t.check(t.sandbox.file(relPath), includes(marker));
    },
  });
}

// skill 正反配对用的固定提示词:两家协议都点名"先查仓库里有没有 skill/guide 文件"——
// claude-code 的原生 Skill 工具会自己判断要不要用,加不加这句都会触发;codex 没有原生
// 触发机制,不显式提示就几乎不会主动去翻 .agents/skills,所以两个 profile 共用同一句
// 提示词,由 profile.skillDetection 决定断言从哪个信号读。
const SKILL_PROMPT =
  "What Effect-TS conventions should I follow for defining a service with a Layer? " +
  "Check whether this repo has a skill or guide file about it before answering, and if you use one, say which file.";

/** skill 正调:装了 skillName 后,安装痕迹(安装 manifest)与行为痕迹(真的被用到)都在。 */
export function skillUsed(p: AgentProfile) {
  if (!p.sandboxTools || !p.skillName) throw new Error("skillUsed eval requires profile.skillName");
  const skill = p.skillName;
  return defineEval({
    description: `skill 正调:装了 ${skill} 之后确实被用到(安装痕迹 + 行为特征,不赌单一措辞)`,
    async test(t) {
      // 安装痕迹的事实源是 adapter 写的安装 manifest(沙箱内 __niceeval__/agent-setup.json,
      // 同一份内容作为 attempt artifact 存成 agent-setup.json),不是某个 installer 的私有 lock 文件。
      await t.group("安装痕迹:agent-setup.json 记录了这个 skill", async () => {
        const manifest = await t.sandbox.readFile("__niceeval__/agent-setup.json").catch(() => "");
        t.check(manifest, includes(skill));
      });

      const turn = await t.send(SKILL_PROMPT);
      turn.expectOk();

      await t.group("行为痕迹:真的用到了这个 skill", () => {
        if (p.skillDetection === "tool") {
          // claude-code 原生 Skill 工具,入参 { skill, args }——不是 t.loadedSkill()
          // (那是 calledTool("load_skill", …) 的糖,专配 eve 协议的 load-skill action,
          // 匹配不上 claude-code 这个原始工具名,见 memory/)。
          t.calledTool("Skill", { input: { skill } });
        } else {
          // codex 没有原生 skill 工具,只能看它是否真的用 shell 读过这个 skill 的文件。
          const dir = p.skillInstallDir ?? ".agents/skills";
          t.calledTool("shell", { status: "completed", input: { command: new RegExp(`${dir}/${skill}`) } });
        }
      });

      // 行为断言可能因为措辞被规避(比如模型转述而不点名文件),judge 兜底看内容是否真沾了skill 的具体指导。
      t.judge.autoevals
        .closedQA(`助手的回答是否引用了名为 "${skill}" 的 skill/guide 文件里的具体指导,而不是泛泛而谈的通用知识?`)
        .atLeast(0.6);
    },
  });
}

/** skill 反调:基线组(没装 skill)对同一个提示词,既没有安装痕迹也没有行为痕迹。 */
export function skillAbsent(p: AgentProfile) {
  if (!p.sandboxTools) throw new Error("skillAbsent eval requires profile.sandboxTools");
  return defineEval({
    description: "skill 反调:没装 skill 时,既没有安装痕迹也不会假装读过 skill 文件",
    async test(t) {
      // 基线组什么都没装 → adapter 不写 manifest(空 artifact 不落文件);即便将来基线挂了 MCP
      // 而有了 manifest,skills 也必须是空的 —— 断言按「manifest 里有没有 skill」写,不按文件在不在写。
      const manifest = await t.sandbox.readFile("__niceeval__/agent-setup.json").catch(() => "{}");
      const installed = (JSON.parse(manifest).skills ?? []) as unknown[];
      t.check(installed.length, equals(0));

      const turn = await t.send(SKILL_PROMPT);
      turn.expectOk();

      if (p.skillDetection === "tool") {
        t.notCalledTool("Skill");
      } else {
        // 与 skillUsed 的正向断言严格镜像:没有一条**成功完成**的 shell 命令碰过 skill 安装
        // 目录。注意不能宽到"命令行里出现 SKILL.md 就算"——提示词本身就叫它去找 skill 文件,
        // 基线 agent 跑 `rg --files -g 'SKILL.md'` 搜一圈(没搜到)是提示词要求的正常行为,
        // 把"搜过"判负会让反例对着提示词红,而不是对着"skill 泄漏进基线"红(实测踩过)。
        const dir = p.skillInstallDir ?? ".agents/skills";
        t.notCalledTool("shell", { status: "completed", input: { command: new RegExp(`${dir}/`) } });
      }
    },
  });
}

/** MCP 正调:点名让它用挂载的 MCP 工具,真的调用且入参正确。 */
export function mcpTool(p: AgentProfile) {
  if (!p.mcpToolName) throw new Error("mcpTool eval requires profile.mcpToolName");
  const tool = p.mcpToolName;
  return defineEval({
    description: "MCP 工具挂载正调:点名工具后确实调用了它(@modelcontextprotocol/server-everything 的 get-sum)",
    async test(t) {
      const turn = await t.send(
        "Use your MCP tools to add 100 and 23 (do not compute it yourself, you must call an MCP tool). Report only the final number.",
      );
      turn.expectOk();
      t.calledTool(tool, { status: "completed", input: { a: 100, b: 23 } });
      t.messageIncludes("123");
    },
  });
}

/** MCP 反调:基线组没挂这个 MCP server,同样的提示词不可能调用到该工具。 */
export function mcpAbsent(p: AgentProfile) {
  if (!p.mcpToolName) throw new Error("mcpAbsent eval requires profile.mcpToolName");
  return defineEval({
    description: "MCP 工具挂载反调:基线组没挂 MCP server,同样的提示词调不到该工具",
    async test(t) {
      const turn = await t.send(
        "Use your MCP tools to add 100 and 23 (do not compute it yourself, you must call an MCP tool). Report only the final number.",
      );
      turn.expectOk();
      t.notCalledTool(p.mcpToolName!);
    },
  });
}
