# Modelo de datos y contratos transaccionales

**Estado:** esquema implementado en `apps/api/migrations/001_core.sql` y `002_access.sql`. Esta página describe SQL y servicios; resultados ejecutados en `docs/qa/`.

## Entidades

| Tabla | Regla persistente |
|---|---|
| users / sessions | ID TEXT, email único, rol validado; refresh hasheado, familia, expiración y revocación |
| events / zones / gates | Organizador propietario; aforo positivo; scope de puerta/zona validado por API |
| price_phases | Precio INTEGER en centésimos; intervalo válido; índice por zona/fechas |
| staff_assignments | Un vínculo usuario/evento |
| zones | Contadores no negativos y `sold_count + reserved_count <= capacity` |
| account_inventory | PK usuario/evento; compras y reservas no negativas |
| reservations | Cantidad, precio capturado, expiración y estado persistidos; índice parcial de activas |
| purchases / tickets | Compra única por reserva; entrada por unidad; comprador/titular separados; versión positiva |
| idempotency | PK usuario/operación/clave; fingerprint y respuesta JSONB |
| payment_ledger | Únicos parciales: charge/reserva, late_refund/reserva, refund/ticket |
| transfers | Índice parcial único impide dos pendientes por ticket |
| revocations | BIGINT secuencial, ticket/versión/motivo; escritores serializados para cursor seguro |
| scanner_devices / scanner_shifts | Scope evento/puerta, propietario, revocación, turnos y última sync |
| scanner_attempts | PK UUID; hash, resultado local y central, tiempos y evidencia separados |
| scanner_admissions | PK evento/ticket; intento ganador único |
| scanner_incidents / audit_log | Append-only mediante triggers y permisos runtime |
| seed_metadata / schema_migrations | Bootstrap idempotente; inaccesibles al rol aplicación |

Usuarios importados usan `rol-id`; identidades nuevas usan UUID como TEXT. Otros IDs importados tienen namespaces `purchase-`, `ticket-`, etc. Eventos/zonas/fases/puertas mantienen IDs enteros. Ticket desconocido en intento no lleva FK: también se conserva el rechazo como evidencia.

Importes INTEGER, sin flotantes. La suma debe caber en rango SQL de 2.147.483.647 centésimos; ampliar a BIGINT requiere adaptar serialización/límites. Fechas TIMESTAMPTZ. La semilla mantiene un desplazamiento temporal común y anchor persistente.

## Inventario y límite por cuenta

`disponibles = capacity - reserved_count - sold_count`.

| Transición | Zona | Contador del comprador |
|---|---|---|
| Reservar | reservadas + cantidad | reservadas + cantidad |
| Pagar | reservadas − cantidad; vendidas + cantidad | reservadas − cantidad; pagadas + cantidad |
| Expirar/cancelar | reservadas − cantidad | reservadas − cantidad |
| Reembolsar/anular | vendidas − 1 | pagadas − 1 |
| Transferir/admitir | sin cambio | sin cambio |

El límite cuenta reservas activas y entradas no devueltas del **comprador original** por evento. Transferir no libera artificialmente consumo de compra. No equivale a limitar todas las entradas recibidas por titular: cambiar esa regla exige bloquear también recepción de transferencias y actualizar los contadores.

Se usa `READ COMMITTED`, bloqueos explícitos y restricciones SQL. Reserva bloquea zona, expira reservas y bloquea fila usuario/evento antes de evaluar límite y fase. Una actualización condicional protege capacidad. Precio se captura al reservar; el cliente no decide el cargo. Si fases se solapan, gana mayor `starts_at` y luego ID; el esquema actual no tiene exclusión SQL para solapamientos.

El barrido y los caminos reserva/pago recuperan vencidas desde PostgreSQL; estado e inventario se cambian una vez en la misma transacción. Reiniciar no reinicia TTL ni pierde la obligación de liberar cupo.

## Bloqueos e idempotencia

Compra adquiere primero advisory lock transaccional por actor/operación/clave. Después se toma zona antes de reservas, usuario/evento o ticket según operación. Transferencia y acceso bloquean ticket antes de resolver su estado. Si se revoca, el advisory lock global de revocaciones se toma después del ticket. Refresh/logout bloquean familia antes de sesión. Sync bloquea UUID antes de ticket. Nuevas rutas deben conservar este orden.

`Db.tx` reintenta hasta tres intentos totales para `40P01`/`40001`, con espera aleatoria breve, liberando cliente. Mitiga fallos transitorios; no demuestra ausencia de deadlocks ni permite efectos externos dentro de callbacks que pueden repetirse.

PK `(user_id,operation,key)` y SHA-256 de inputs normalizados con forma fija preservan idempotencia. Misma clave/payload recupera respuesta; diferente payload produce `IDEMPOTENCY_CONFLICT`. Errores con rollback no dejan respuesta. Una colisión de hash advisory causa contención adicional; la unicidad SQL sigue siendo necesaria.

Cargo simulado, compra, entradas y respuesta comparten transacción. Unicidad del ledger también impide doble cargo con distintas claves para una misma reserva. Pago tardío registra `late_refund` una vez y no emite. No existe cargo remoto real: una futura pasarela requiere idempotencia externa, outbox y conciliación.

Reembolso/anulación bloquean zona y ticket; rechazan uso, verifican permisos/plazo, cancelan pendientes, revocan versión y devuelven cupo. El reembolso corresponde al comprador original. Un ingreso físico offline recibido después de un reembolso se conserva como conflicto: SQL no puede deshacerlo físicamente.

## Sincronización y evidencia

UUID pertenece al intento, no al HTTP. Máximo 500 intentos/lote, confirmados en transacciones individuales. Reenviar tras fallo parcial no duplica los ya confirmados. Otro payload o dispositivo para UUID existente produce `id_conflict` e incidente sin cambiar el original.

La PK central evento/ticket y el bloqueo del ticket arbitran ingreso, transferencia y reembolso. Segundo intento localmente aceptado genera `double_ingress`, conserva ambos resultados y señala que el orden físico es desconocido. El primero confirmado centralmente no demuestra ser el primero ocurrido.

Cursores de revocación BIGINT se transmiten como string. Escritores toman advisory lock global **antes** de asignar ID, evitando una secuencia menor pendiente de commit detrás de otra visible. Lectura fija high-water mark antes de registros y pagina sin saltar commits. Cursor adelantado se rechaza y exige bootstrap.

SQLite local usa WAL, índices de pendientes/uso y transacción exclusiva para aceptación previa + inserción. Confirmar sync añade resultado central y marca de envío, sin borrar intento ni reemplazar resultado local.

## Índices y riesgos

Expiración activa, fase por zona, familia de sesión y unicidades soportan integridad/consultas críticas. Rendimiento de portal requiere EXPLAIN real en QA. Índice de tickets empieza por titular/fecha, pero wallet pagina por ID: revisar plan antes de afirmar optimalidad. Coherencia evento/puerta/zona se valida en API y no está totalmente expresada con FKs compuestas. CHECK no detecta por sí solo cualquier divergencia de contadores: reconciliarlos contra filas reales en pruebas.
