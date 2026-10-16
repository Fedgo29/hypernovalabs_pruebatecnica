# Informe al Director Técnico — Fase 1

**Fecha:** 14 de octubre de 2026 (America/Panama).

**Objetivo:** verificar el estado real, leer las fuentes, clasificar el dataset,
trazar los requisitos y acordar una arquitectura antes de implementar.

**Trabajo realizado:** inspección Git y filesystem; documentación de requisitos,
arquitectura, modelo transaccional, cuatro ADR, amenazas y estrategia QA;
auditoría reproducible y generación de semilla sanitizada. Las instrucciones
adjuntas se distinguen del enunciado posteriormente proporcionado en texto.

**Decisiones:** NestJS como backend entre las dos opciones del enunciado,
PostgreSQL como autoridad, monolito modular, portal React independiente y Expo
para ambos modos. Inventario y límite por cuenta transaccionales; idempotencia
persistente; Ed25519 del emisor más prueba rotativa del titular; SQLite y
arbitraje central que conserva conflictos offline. Ninguna decisión implica
que la función ya exista o esté probada. El diseño se validará por fases.

**Validación ejecutada:**

| Comando/comprobación | Resultado observado |
|---|---|
| `git rev-parse --show-toplevel` | `/workspace/hypernovalabs_pruebatecnica` |
| Remoto sanitizado | `github.com/Fedgo29/hypernovalabs_pruebatecnica.git` |
| `git status --porcelain=v1 --untracked-files=all` antes de cambios | Limpio |
| `git log -5` y `git ls-tree -r HEAD` | Un commit inicial; únicamente README de 29 bytes |
| `git ls-remote --heads origin` | Única rama anunciada `main`, commit `3aeaca8a615d78c96b090ffae7a3701fbcebd3ee` |
| Rama inicial y rama de trabajo | `work` → `docs/fase-1-auditoria`; sin push ni merge |
| Comparación binaria de tres textos adjuntos | Idénticos |
| Búsqueda de `enunciado.html` | No estaba en el checkout; usuario aportó después el texto completo |
| Auditoría original y semilla sanitizada | 138 comprobaciones cada uno, 0 defectos confirmados; 1 observación de namespace de identidad |
| Repetición del sanitizador y `cmp` | Salida determinista, código 0 |
| Verificación interna de sanitización | 616 campos password eliminados; valores sensibles originales ausentes |
| Herramientas locales | Node 24.19.0, npm 11.9.0, Python 3.12.14, Docker 28.4.0, Compose 2.40.3; daemon responde |
| `git diff --check` | Sin errores de whitespace |

Ver [auditoría del dataset](../qa/dataset.md) y reportes JSON para conteos,
supuestos, hash y detalles. No se ejecutaron pruebas de la app en esta fase;
todavía no existía aplicación. La disponibilidad de Docker no equivale a un
arranque del stack del proyecto.

**Hallazgos:**

- No hay lógica, dependencias, CI ni arquitectura previa que preservar.
- IDs legados de usuarios coinciden entre roles: 16 IDs compartidos/32 filas.
  La importación debe mapear `(rol, id)` a identidad interna, no usar ID global.
- Dataset incluye nombres, emails y passwords sin prueba de que sean ficticios;
  original privado fuera de Git; semilla pública sanitizada preserva relaciones.
- Referencia del dataset: `2026-09-01T06:00:00Z`; las 320 reservas ya expiraron.
  La demostración requiere desplazamiento temporal documentado y estable.
- Zona 8 tiene 50 restantes a la referencia. Ese cálculo ya se comprobó, pero
  no constituye una prueba de sobreventa del software futuro.
- Desconexión simultánea permite doble ingreso físico; el enunciado exige
  detección posterior, un ingreso lógico y preservación del incidente.
- Pesos publicados suman 120; se conserva el dato, sin normalización inventada.

**Estado:** Fase 1 completada con enunciado recibido en texto y síntesis marcada
como tal. Implementación, carga, compatibilidad nativa móvil y video pendientes.

**Próximo paso:** construir y comprobar la base NestJS/PostgreSQL/Compose,
identidad y compras; prioridad a 200/50, idempotencia, expiración y permisos.
Portal, protocolo y app avanzan en paralelo sobre contratos explícitos, con
validación intermedia antes de declarar cada flujo terminado.
