# Orkion

Prototipo local en Bun + TypeScript para orquestar un manager agent, un subagente y herramientas MCP.

El subagente principal de consultas se llama `Lyra` y se encarga de busquedas web, lectura de paginas y reportes.

## Requisitos

- Bun 1.3+
- Un `.env` con al menos una key válida

## Variables de entorno

Usa `.env.example` como base.

Secrets soportados:

- `OPENROUTER_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `XAI_API_KEY`
- `GROQ_API_KEY`

Overrides opcionales de modelo:

- `OPENROUTER_MODEL`
- `OPENAI_MODEL`
- `ANTHROPIC_MODEL`
- `XAI_MODEL`
- `GROQ_MODEL`

## Comandos

```bash
bun install
bun run dev
bun run start
bun run test
bun run typecheck
```

## Uso

CLI interactivo:

```bash
bun run start
```

CLI con tarea directa:

```bash
bun run start --provider=openrouter "Busca informacion sobre MCP y arma un reporte corto"
```

Overrides disponibles:

- `--provider=openrouter`
- `--provider=groq`
- `--model=meta-llama/llama-3.3-8b-instruct:free`
- `--json`

Comandos interactivos:

- `/provider openrouter`
- `/provider groq`
- `/model meta-llama/llama-3.3-8b-instruct:free`
- `/json on`
- `/exit`

## Flujo del prototipo

1. El manager recibe la tarea.
2. Resuelve provider y modelo segun config, keys y preferencias.
3. Si la tarea parece necesitar tools, delega a `Lyra`.
4. `Lyra` llama un MCP local por `stdio`.
5. El manager consolida la respuesta final.

## MCP actual

Tools locales disponibles:

- `calculate`
- `searchKnowledge`
- `searchWeb`
- `fetchWebPage`
- `formatReport`

`searchWeb` y `fetchWebPage` usan `curl` para consultas web basicas.

## Consola en tiempo real

El CLI ahora muestra estados de:

- manager
- Lyra
- MCP
- provider/modelo

Y cuando el provider soporta streaming, la respuesta del modelo se imprime en tiempo real en consola.
