# ADR 001 — Monolito modular y autoridad en PostgreSQL

**Estado:** adoptada; implementación presente. Evidencias ejecutadas en QA.

**Contexto:** enunciado recibido y dirección requieren NestJS, PostgreSQL, Expo y portal separado; plazo de referencia cuatro días, sin lógica previa que preservar.

**Alternativas:** microservicios por dominio; monolito sin límites; monolito modular con SQL directo.

**Decisión:** NestJS 11.2.7 con `pg` 8.16.3, PostgreSQL 16, portal React 19.1.0/Vite 7.3.7 y Expo 54.0.37/RN 0.81.5. Workspace npm, TypeScript estricto y contratos compilados CommonJS. Expiración dentro de la API. Sin Redis.

**Justificación:** transacciones locales unen inventario, pago simulado, tickets y evidencia; SQL explícito facilita revisar bloqueo y unicidades. Portal tiene despliegue separado sin convertir los dominios en servicios remotos.

**Riesgos:** contención con consultas administrativas; paginar e indexar con EXPLAIN. Caché de disponibilidad de 500 ms por instancia es informativa; compra revalida DB. Rate limiting en memoria no agrega varias instancias. Barrido de un segundo requiere SQL recuperable.

**Validación:** compilar contratos/API/portal y exportar Metro móvil; ejecutar pruebas reales PostgreSQL y arranque de Compose desde clon limpio. Consultar resultados efectivos en `docs/qa/`; compilación no acredita funcionamiento móvil ni despliegue limpio.
