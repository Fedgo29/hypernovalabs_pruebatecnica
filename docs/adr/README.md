# Registro de decisiones

Las decisiones son propuestas técnicas de Fase 1; ninguna implica implementación
ni prueba. Las tecnologías obligatorias vienen de dirección técnica y se
contrastarán con el enunciado ausente.

| ADR | Decisión | Estado |
|---|---|---|
| [001](001-modular-monolith.md) | Monolito modular y PostgreSQL como autoridad | Propuesta |
| [002](002-transactions-idempotency.md) | Invariantes transaccionales e idempotencia SQL | Propuesta |
| [003](003-offline-credentials.md) | Credencial del emisor + posesión rotativa del titular | Propuesta; compatibilidad móvil pendiente |
| [004](004-sync-audit.md) | SQLite local, intentos inmutables y admisión central única | Propuesta |
