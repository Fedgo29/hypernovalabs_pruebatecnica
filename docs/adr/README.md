# Registro de decisiones

El enunciado fue recibido en la conversación; existe una síntesis identificada en `docs/requirements/enunciado.md`. Estas decisiones documentan el diseño adoptado y código presente. **Adoptada** no significa que todas sus verificaciones pasaron: resultados efectivos y pendientes en `docs/qa/`.

| ADR | Decisión | Estado |
|---|---|---|
| [001](001-modular-monolith.md) | Monolito modular y PostgreSQL autoridad | Adoptada |
| [002](002-transactions-idempotency.md) | Inventario, límite e idempotencia SQL | Adoptada |
| [003](003-offline-credentials.md) | Ed25519: credencial + posesión temporal | Adoptada; dispositivo pendiente |
| [004](004-sync-audit.md) | SQLite y evidencia con ingreso central único | Adoptada; dispositivo pendiente |

Cada ADR mantiene contexto, alternativas, decisión, justificación, riesgos y validación. Una nueva regla de negocio o integración real de pagos exige revisar las decisiones afectadas y sus pruebas.
