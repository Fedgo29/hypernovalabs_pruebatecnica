# Modelo propuesto y contratos transaccionales

**No hay migraciones ni tablas creadas.** Este modelo identifica invariantes y
pruebas antes de implementar; el dataset se conservará como entrada externa,
no como esquema normativo. Tipos concretos y estados se contrastarán con el
enunciado.

## Entidades y restricciones

| Entidad propuesta | Restricciones y datos importantes |
|---|---|
| users / sessions | Identidad, rol, hash de contraseña; refresh hasheado, familia, expiración y revocación |
| events / zones / gates | Organizador propietario; zona y puerta del mismo evento; aforo no negativo |
| price_phases | Zona, intervalo temporal, precio entero; evitar solapamientos ambiguos |
| staff_assignments / devices | Alcance por evento/puerta, revocación de dispositivo, última sync |
| inventory | Por zona: capacidad, reservadas y vendidas; `CHECK >= 0` y suma ≤ capacidad |
| account_event_usage | Fila por usuario/evento para serializar el límite; semántica pendiente |
| reservations | Usuario, zona, cantidad, precio/fase capturados, expiración, estado, clave |
| idempotency_operations | `UNIQUE(actor, operation, key)`, hash canónico del payload, resultado durable |
| payments / refunds | Operación/reserva única donde aplique; importes enteros, estado, actor/motivo |
| purchases / tickets | Emisión única por unidad comprada; titular, versión de credencial, estado |
| transfers | Emisor/receptor, estados y tiempos; a lo sumo una pendiente por entrada |
| revocations | Secuencia central monotónica, ticket/version, motivo, momento |
| scan_attempts | UUID global único, dispositivo, payload/hash, resultado local y central separados |
| admissions | `UNIQUE(event_id, ticket_id)`, intento central vencedor y momento de arbitraje |
| incidents / audit_log | Conflictos preservados; autor/motivo/antes/después; sin UPDATE/DELETE por rol app |

Importes en enteros de centésimos con límites explícitos de rango; no usar
flotantes. Fechas con zona horaria en PostgreSQL; el servidor es autoridad para
expiración y precio. IDs de importación necesitan namespace/tabla de mapeo para
no confundir históricos con UUID del sistema.

## Inventario y compras

Por zona, `disponibles = capacidad - reservadas - vendidas`. Reservar aumenta
reservadas; pagar mueve la cantidad de reservadas a vendidas; expirar reduce
reservadas una sola vez. El efecto de reembolsar sobre disponibilidad se fijará
con el enunciado. Un ticket usado sigue contando para el aforo del evento.

Una transacción de reserva bloquea filas de inventario y uso por cuenta, relee
sus valores, valida cantidad, precio, vigencia y límite, y persiste resultado y
auditoría. Se propone `READ COMMITTED` con bloqueos explícitos y restricciones
SQL; no basta consultar disponibilidad y escribir después. Una actualización
condicional atómica es alternativa válida cuando evita separar validación y cambio.

Todas las operaciones que toquen las mismas entidades deben seguir un orden
de bloqueos único. El orden concreto se documentará junto al SQL de migraciones;
expiración, pago, devolución y transferencia se prueban también contra ese orden.
No se presupone que `SKIP LOCKED` o un mutex de proceso resuelvan las carreras.

El worker selecciona vencidas persistidas, revalida bajo bloqueo y cambia estado
e inventario en la misma transacción. Arranque recupera trabajo vencido. Reservar
debe poder recuperar cupo vencido sin depender únicamente del intervalo del worker.
No se utilizarán temporizadores en memoria como fuente de verdad.

## Idempotencia y estados

La unicidad de la clave arbitra solicitudes concurrentes. Tras un conflicto de
inserción se lee el resultado confirmado, no se procesa una segunda compra.
Canonicalización excluye campos sin efecto y normaliza tipos de forma explícita;
misma clave con distinto payload da conflicto. No se sustituye el resultado de
una operación por un estado transitorio diferente al repetir la solicitud.

Pago simulado persistido + transición de reserva + emisión + auditoría pueden
ser atómicos dentro de PostgreSQL. Si después se integra una pasarela real se
necesitarán idempotencia externa y outbox: una transacción SQL no incluye un
cargo remoto. Se propone tardío → reembolso simulado → sin emisión; deben
probarse reinicios y duplicados en cada frontera de transición.

Reembolso, transferencia, anulación e ingreso compiten por el mismo estado del
ticket. Se bloqueará el ticket y se releerá su estado, en vez de validar antes
de la transacción. Un intento offline tardío se conserva aunque el estado haya
cambiado; el resultado central explicita el conflicto, nunca reescribe el hecho
local de que hubo una admisión.

## Accesos y cursor

Un UUID identifica un intento, no una petición HTTP. Reenviar el mismo UUID con
el mismo contenido devuelve la decisión original; con contenido distinto es
conflicto. `admissions` tiene unicidad por ticket/evento, independiente de su
versión de credencial. El segundo intento localmente aceptado crea incidente,
no una segunda admisión lógica ni la eliminación del intento.

Las revocaciones usan secuencia del servidor, no timestamps del teléfono.
Cursor y lote deben poder reintentarse; retención y recuperación mediante
snapshot completo se definirán. Autenticación del dispositivo no vuelve
confiable su reloj ni permite probar con certeza cuándo ocurrió un hecho offline.

Índices candidatos: reservas activas por expiración, tickets por evento/titular,
sesiones por familia, intentos por dispositivo/UUID, revocaciones por secuencia,
incidentes por evento/estado y auditoría por evento/tiempo. Se conservará un
EXPLAIN real antes de justificar su coste de escritura o afirmar mejoras.
