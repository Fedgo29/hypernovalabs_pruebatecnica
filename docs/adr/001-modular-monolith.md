# ADR 001 — Monolito modular y autoridad en PostgreSQL

**Estado:** propuesta, pendiente de enunciado.

**Contexto:** no hay código previo; dirección requiere API NestJS, PostgreSQL,
Expo y portal separado, en un plazo de cuatro días.

**Alternativas:** microservicios por dominio; monolito sin límites; monolito
modular con worker del mismo código.

**Decisión:** proponer monolito modular, PostgreSQL único para estado crítico,
portal React en contenedor propio y Expo para ambos modos. No introducir Redis.

**Justificación:** permite transacciones locales de inventario, pagos, accesos y
auditoría, menos despliegues y contratos internos claros.

**Riesgos:** consultas del portal pueden competir con ventas; separar consultas,
paginar e indexar según EXPLAIN. El worker debe coordinarse mediante DB.

**Validación:** pendiente de compilación estricta, pruebas con PostgreSQL y
arranque desde clon limpio. Docker disponible no valida aún la aplicación.
