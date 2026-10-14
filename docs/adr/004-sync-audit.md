# ADR 004 — Intentos persistentes y arbitraje central del ingreso

**Estado:** propuesta, pendiente de enunciado y prototipo SQLite móvil.

**Contexto:** miles de intentos offline, reinicios, reenvíos y dos puertas que
aceptan la misma entrada sin poder comunicarse.

**Alternativas:** almacenamiento en memoria; listas en almacenamiento clave/valor;
SQLite transaccional con UUID por intento y sincronización de lotes.

**Decisión:** proponer SQLite para cola local, registro de cada intento y marcador
único de admisión local. Servidor conserva resultado local y decisión central
por separado. Unicidad central ticket/evento, UUID idempotente y revocaciones
con cursor secuencial. Segundo aceptado offline crea incidente auditable.

**Justificación:** reinicios y pérdida de respuesta no borran intentos ni los
duplican. El conflicto queda visible y no se oculta alterando el historial.

**Riesgos:** dos puertas offline pueden admitir físicamente al mismo titular;
orden central de sincronización no prueba el primer ingreso físico. Reloj y
declaración del dispositivo son evidencia no confiable. Batch debe definir
límites, errores parciales y reintentos sin descartar fallos.

**Validación:** pendientes reinicio móvil, miles de filas, doble scan local,
dos puertas offline, lote repetido, UUID con payload distinto, transferencia
entre scan y sync y cursor antiguo. Auditoría central se probará con un rol
de DB sin permiso UPDATE/DELETE; el administrador de DB sigue siendo privilegiado.
