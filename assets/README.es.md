<div align="center">

# NiceEval

**Una herramienta ligera de evals para agentes de IA: progresiva, nativa para agentes y con una DX excelente**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](../tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](../package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](../docs/README.md)

[English](../README.md) | [中文](../README.zh.md) | [Deutsch](README.de.md) | [français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Português](README.pt.md) | [Русский](README.ru.md)

</div>

NiceEval es una herramienta genérica de evals para agentes de IA, inspirada en [eve](https://eve.dev). Antes que nada, tiene un diseño de DX excelente: cualquiera puede empezar a usarla y configurarla en unos 10 minutos. Además, su diseño es muy general: sirve tanto para evaluar plugins, Hooks y Skills de coding agents escritos para Claude Code/Codex, como para evaluar directamente tu propio framework de AI Agent (ya esté basado en AI SDK, LangGraph, Pi o cualquier otro, es fácil de integrar).

Al terminar una eval se genera un informe fácil de leer y puedes inspeccionar el detalle del comportamiento del agent, lo que facilita hacer debug y entender qué hizo el agent.

## Por qué necesitas NiceEval si ya existen DeepEval, LangFuse o BrainTrust

NiceEval es una herramienta de evaluación nativa para IA (AI Native). En muchas de esas herramientas, construir un Dataset con pares de Input y Output esperado (golden) no encaja bien con la evaluación de agentes reales. Además, cuando un Agent necesita evaluarse con detalle en conversaciones de múltiples turnos, múltiples agentes, llamadas a herramientas, carga de Skills, etc., NiceEval lo hace mejor.

Al mismo tiempo, puede coexistir con LangFuse y BrainTrust: puedes usar el primero para hacer tracing, o subir los resultados de la evaluación a ambos (en desarrollo).

## Arquitectura

NiceEval admite dos formas de integración, según si el sistema bajo prueba necesita un sistema de archivos aislado en un sandbox.

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
   ┌─────────────────────────────┐
   │       Docker Sandbox        │
   │    ┌─────────────────────┐  │
   │    │ Codex / Claude Code │  │
   │    │ App que necesita FS │  │
   │    │       aislado       │  │
   │    └─────────────────────┘  │
   └─────────────────────────────┘
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
   ┌────────────────────────────┐
   │    Tu propio Web Agent     │
   │ (HTTP / AI SDK · LangGraph │
   │    Pi u otro framework     │
   │    propio, sin Docker)     │
   └────────────────────────────┘
```

- **El núcleo de NiceEval** se encarga de descubrir evals, orquestar la ejecución, calificar, y generar informes y artifacts.
- **El Adaptador de Agent** es el límite abierto: tú decides cómo invocar al sistema bajo prueba.
- Los coding agents que necesitan aislamiento de sistema de archivos pasan por **Docker Sandbox**; tu propio Web Agent puede conectarse directamente, sin necesidad de Docker.

## Ejemplo

Para ejecutar una eval se necesitan dos archivos: la eval en sí (qué se prueba) y el experiment (qué agent se ejecuta). La CLI no acepta un id de eval suelto: en `niceeval exp <experiment> <prefijo-de-eval>`, el experiment es justamente lo que decide «a qué sistema bajo prueba conectarse». A continuación un caso real de conexión directa a un Web Agent (proyecto completo en [`examples/zh/ai-sdk/`](../examples/zh/ai-sdk/)), que verifica que, ante una pregunta sobre el clima en tiempo real, el agent llama a la herramienta correcta y responde basándose en el resultado de esa herramienta, en lugar de inventar datos:

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
});
```

```sh
pnpm exec niceeval exp local eval-tool-call  // usa el experiment local para ejecutar solo eval-tool-call
pnpm exec niceeval view // consulta los resultados de la evaluación
```

## Inicio rápido

```text
READ https://niceeval.com/INIT.md and install niceeval for this repo.
```

Empieza por tu escenario:

- [Si necesitas evaluar tu plugin de Claude Code / Codex](https://niceeval.com/docs/example/claude-code-codex-plugin)
- [Si necesitas evaluar tu Skill de Claude Code / Codex](https://niceeval.com/docs/example/claude-code-codex-skill)
- [Si necesitas evaluar tu aplicación de AI Agent](https://niceeval.com/docs/example/ai-agent-application)

## Roadmap

Adaptadores oficiales
- [ ] Software de Agent
  - [ ] Claude Code
  - [ ] Codex
  - [ ] Bub
  - [ ] OpenClaw
  - [ ] Hermess Agent
  - [ ] Alma
  - [ ] ...

- [ ] Frameworks de Agent
  - [ ] AI SDK
  - [ ] LangGraph
  - [ ] Claude SDK
  - [ ] Codex SDK
  - [ ] vm0
  - [ ] Cursor Agent SDK

## Documentación

- [Inicio rápido](https://niceeval.com/docs/quickstart)

# Agradecimientos

Este proyecto está inspirado en los siguientes proyectos, o la IA aprendió a partir de su código para escribirlo
[eve](https://eve.dev)
[agent eval](https://github.com/vercel-labs/agent-eval)
[ponytail](https://github.com/DietrichGebert/ponytail)

Gracias a las siguientes comunidades
</content>
</invoke>
