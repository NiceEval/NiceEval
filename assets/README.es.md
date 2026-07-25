<div align="center">

# NiceEval

**Una herramienta de evals para agentes de IA: progresiva, Agent-Native y con una DX excelente**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](../tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](../package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](../docs/README.md)
[![discord](https://img.shields.io/badge/discord-join%20chat-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/yTMdZjFFJ)

[English](../README.md) | [中文](../README.zh.md) | [Deutsch](README.de.md) | [français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Português](README.pt.md) | [Русский](README.ru.md)

</div>

NiceEval es una herramienta de eval para agents que ayuda a los equipos a medir, evaluar y mejorar la IA en producción. Con NiceEval, los equipos pueden comparar modelos, iterar sobre sus agents, detectar regresiones y seguir mejorando sus aplicaciones de IA usando datos reales de usuarios.

NiceEval es local-first en su núcleo: tus evals se ejecutan en tu propio entorno. Cuando tu equipo necesite compartir evals o hacer seguimiento de regresiones, puedes enviar un Report a plataformas como BrainTrust, o exportar un informe personalizado.

## Por qué necesitas NiceEval si ya existen DeepEval, LangFuse o BrainTrust

NiceEval es una herramienta de evaluación Agent-Native. El patrón de Dataset / golden —«construir un Input y un Expected Output»— no encaja con la evaluación de agents reales.
Hoy los agents necesitan evaluarse en escenarios de grano fino: conversaciones de múltiples turnos, colaboración entre múltiples agents, llamadas a herramientas, carga de Skills, etc., y NiceEval lo hace mejor.

Al mismo tiempo, NiceEval puede coexistir con LangFuse y BrainTrust: puedes usarlos para hacer tracing, o subir los resultados de la evaluación a ambos.

## Arquitectura

NiceEval admite dos formas de integración, según si el agent bajo prueba necesita un sistema de archivos aislado en un sandbox.

**Modo 1: Sandbox (Docker, E2B) — para ejecutar coding agents como Codex o Claude Code que necesitan sandbox**

```text
   evals/*.eval.ts
        │
        ▼
   ┌────────────┐
   │  NiceEval  │
   └────────────┘
        │
        │ Adaptador de Agent (oficial)
        ▼
   ┌───────────────────────────────────────┐
   │            Docker Sandbox             │
   │   ┌───────────────────────────────┐   │
   │   │ Codex / Claude Code           │   │
   │   │ apps que necesitan un sistema │   │
   │   │ de archivos aislado           │   │
   │   └───────────────────────────────┘   │
   └───────────────────────────────────────┘
```

**Modo 2: Conexión directa — conecta directamente tu propio AI Agent**

```text
   evals/*.eval.ts
        │
        ▼
   ┌────────────┐
   │  NiceEval  │
   └────────────┘
        │
        │ Adaptador de Agent (oficial o propio)
        ▼
   ┌───────────────────────────┐
   │    Tu propio AI Agent     │
   │  (AI SDK·LangGraph·Pi)    │
   └───────────────────────────┘
```

- **El núcleo de NiceEval** se encarga de descubrir evals, orquestar la ejecución, calificar, y generar informes y artifacts.
- **El Adaptador de Agent** es el límite abierto: tú decides cómo invocar al sistema bajo prueba.
- Los coding agents que necesitan aislamiento del sistema de archivos pasan por el **Docker Sandbox**; tu propio AI Agent puede conectarse directamente, sin necesidad de Docker.

## Conceptos clave de un vistazo

| Concepto | En una frase |
|---|---|
| Eval | Un caso de prueba: escrito en `evals/*.eval.ts`, describe qué se comprueba. |
| Experiment | Una configuración de ejecución versionada: qué Adapter, qué modelo, qué flags. |
| Adapter | La capa que conecta con el sistema bajo prueba: implementas un `send` y obtienes un flujo de eventos estándar. |
| Sandbox | Solo hace falta para coding agents que necesitan un workspace aislado; un web agent con conexión directa no lo necesita. |
| Tier | Tres niveles de esfuerzo para integrar un Adapter: Tier 1 solo conecta `send`, Tier 2 añade OTel para obtener un call waterfall, Tier 3 hace cambios invasivos para pruebas A/B de features. |

Consulta el glosario completo en la [visión general de la arquitectura](https://niceeval.com/docs/concepts/overview).

## Ejemplo

```ts
// evals/eval-tool-call.eval.ts
import { defineEval } from "niceeval";

export default defineEval({
  description: "Prueba la capacidad del agent de llamar correctamente a la herramienta en preguntas sobre el clima en tiempo real y responder según el resultado",

  async test(t) {
    const turn = await t.send("¿Qué tiempo hace hoy en Beijing?");
    t.succeeded();

    await t.group("Llama a get_weather con la ciudad correcta", () => {
      t.calledTool("get_weather", { input: { city: "Beijing" } });
      t.messageIncludes(/°C|temperatura|clima|soleado|nublado|lluvia/);
    });

    const second = await t.send("¿Qué tiempo hará mañana en Shanghai?");
    second.messageIncludes("Shanghai");

    t.judge.autoevals
      .closedQA("¿La respuesta del asistente se basa en los datos meteorológicos devueltos por la herramienta, en lugar de inventar la temperatura?")
      .atLeast(0.7);
  },
});
```

```ts
// experiments/local.ts
import { defineExperiment } from "niceeval";
import { webAgent } from "./adapter"; // tu propio adaptador de agent, que conecta con el web agent bajo prueba

export default defineExperiment({
  agent: webAgent({ baseUrl: "http://127.0.0.1:5188" }),
  model: "gpt-5.5"
});
```

```sh
pnpm exec niceeval exp local eval-tool-call  // usa el experiment local para ejecutar solo eval-tool-call
pnpm exec niceeval view // consulta los resultados de la evaluación
```

## Inicio rápido

```text
READ https://niceeval.com/INIT.md and set up niceeval for this repo: install it, integrate it with this project, and run the first eval end to end.
```

Empieza por tu escenario:

- [Si necesitas evaluar tu plugin de Claude Code / Codex](https://niceeval.com/docs/example/claude-code-codex-plugin)
- [Si necesitas evaluar tu Skill de Claude Code / Codex](https://niceeval.com/docs/example/claude-code-codex-skill)
- [Si necesitas evaluar tu aplicación de AI Agent](https://niceeval.com/docs/example/ai-agent-application)


## Roadmap
Adaptadores oficiales
- [ ] Software de Agent
  - [x] Claude Code
  - [x] Codex
  - [x] Bub
  - [ ] OpenClaw
  - [ ] Hermess Agent
  - [ ] Alma
  - [ ] ...

- [ ] Frameworks de Agent
  - [x] AI SDK
  - [x] Claude SDK
  - [x] Codex SDK
  - [x] Pi Agent SDK
  - [ ] LangGraph
  - [ ] vm0
  - [ ] Cursor Agent SDK

## Documentación

- [Inicio rápido](https://niceeval.com/docs/quickstart)

# Agradecimientos
Este proyecto está inspirado en los siguientes proyectos, o fue escrito por una IA que aprendió del código de los siguientes proyectos
- [eve](https://eve.dev): la principal inspiración de DX y API
- [agent eval](https://github.com/vercel-labs/agent-eval)
- [ponytail](https://github.com/DietrichGebert/ponytail)

Gracias a las siguientes comunidades
- WIP
