# ADR 002 — Inventario, límite por cuenta e idempotencia en SQL

**Estado:** propuesta, pendientes reglas exactas del enunciado.

**Contexto:** 200 compradores por 50 entradas, reintentos simultáneos, expiración
tras reinicio y pagos tardíos deben mantener coherencia.

**Alternativas:** mutex en memoria; inventario eventualmente consistente;
aislamiento serializable; bloqueos por fila con restricciones y actualizaciones
condicionales.

**Decisión:** proponer transacciones PostgreSQL con filas de inventario y uso por
cuenta, restricciones de capacidad/no negatividad y clave idempotente única con
hash del payload. Expiraciones persistentes; precio capturado del servidor.
Proponer pago tardío con reembolso simulado idempotente sin emitir entrada.

**Justificación:** funciona con reinicios y varias instancias; claves diferentes
no eluden el límite. Una misma clave no produce dos cobros ni tickets.

**Riesgos:** deadlocks y contención; elegir orden único y reintentos acotados por
SQLSTATE. La devolución de cupo y el cómputo de titular/comprador son reglas aún
desconocidas. No hacer llamadas a una pasarela dentro de una transacción larga.

**Validación:** pendientes carrera 200/50, límite concurrente, misma clave/payload
distinto, recuperación tras reinicio y carreras pago/expiración/reembolso/ingreso.
No hay resultados de carga ni tiempos publicados.
