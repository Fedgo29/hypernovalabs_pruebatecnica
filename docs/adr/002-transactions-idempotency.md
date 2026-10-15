# ADR 002 — Inventario, límite de cuenta e idempotencia SQL

**Estado:** adoptada; implementada en migración core y CommerceService. Evidencias de carreras en QA.

**Contexto:** 200 compradores por 50 entradas, reintentos, límite por evento, vencimiento tras reinicio y cupo recuperado por reembolso deben ser coherentes.

**Alternativas:** mutex en memoria; consistencia eventual; aislamiento serializable general; bloqueos por fila y restricciones SQL.

**Decisión:** `READ COMMITTED`, bloquear zona y contador usuario/evento, actualización condicional de capacidad y CHECK no negativos/suma≤aforo. Idempotencia mediante advisory lock por actor/operación/clave más PK, fingerprint y respuesta SQL. TTL 600 segundos; expiraciones persistidas, barrido y recuperación en caminos de compra. Pago tardío registra reembolso simulado una vez, sin emisión. Reembolso/anulación devuelve cupo una vez; límite permanece asociado al comprador original al transferir.

**Justificación:** válido con reinicios y múltiples procesos. Claves diferentes no eluden límite ni duplican cargo por reserva. Precio se fija en servidor al reservar. Todas las operaciones simuladas se confirman juntas.

**Riesgos:** deadlocks/contención; orden documentado en modelo, reintentos acotados para SQLSTATE 40P01/40001. No introducir llamadas externas dentro de callbacks reintentables. INTEGER requiere límites de importe. Límite de compras no limita entradas recibidas mediante transferencia: conservar esta semántica explícita.

**Validación:** carrera 200/50 con reconciliación SQL, misma clave concurrente/payload distinto, claves diferentes sobre una reserva, vencimiento/reinicio, reembolso doble y carreras pago/expiración/transferencia/ingreso. Los comandos, ventas, p50/p95 y errores se publican solo después de ejecución en QA.
