# Enunciado: síntesis estructurada

El usuario aportó el contenido del enunciado en la conversación después de la
auditoría inicial. El archivo `enunciado.html` original no está en el checkout.
Este documento es una **síntesis de los requisitos comunicados**, no una
transcripción completa o literal del HTML. La dirección técnica se conserva
por separado en [direccion-tecnica.md](direccion-tecnica.md); los criterios
comprobables están en [matrix.md](matrix.md).

## Plataforma y alcance

- Plataforma de ticketing de eventos y control de acceso.
- Backend REST con NestJS o .NET; la dirección técnica concreta NestJS.
- PostgreSQL como fuente de verdad para las operaciones críticas.
- Aplicación React Native con Expo y TypeScript, con modo asistente y staff.
- Portal administrativo web en un contenedor independiente.
- Inicialización automática mediante Docker Compose, migraciones y semillas.
- Plazo de referencia de cuatro días; primero requisitos obligatorios e
  invariantes, después bonus opcionales.

## Compra y entradas

- Inventario de zonas protegido bajo concurrencia: 200 compradores por 50
  entradas deben terminar con exactamente 50 entradas vendidas, sin sobreventa,
  reservas inconsistentes ni inventario negativo.
- Flujo de reserva temporal, pago simulado y emisión de entrada, con liberación
  fiable de reservas expiradas y política documentada para pagos tardíos.
- Endpoints monetarios idempotentes; reintentos concurrentes no duplican
  cargos, entradas o reembolsos. Una clave no puede reutilizarse con otro payload.
- Precios calculados en el servidor según la fase vigente al reservar;
  importes almacenados como enteros de centésimos y límite por usuario/evento
  respetado bajo concurrencia.
- Reembolsos dentro del plazo permitido, rechazados para entradas usadas;
  un reembolso válido devuelve cupo exactamente una vez.
- Transferencias válidas con revocación de la credencial anterior y
  cancelación de transferencias pendientes.

## Aplicación del asistente

- Cartelera, contador, billetera e historial.
- Registro, inicio y cierre de sesión, con refresh tokens rotados y revocables.
- Credenciales de entrada auténticas verificables offline y códigos rotativos
  con ventanas temporales cortas; la clave privada emisora queda en el servidor.
- Estados explícitos de carga, vacío y error.
- Roles y autorización por recurso para evitar acceso a eventos ajenos.

## Staff y modo offline

- Inicio de turno vinculado a una puerta; validar evento y zona del ticket.
- Validación offline de firma y vigencia, rechazo local de entradas ya
  aceptadas y almacenamiento persistente para miles de escaneos.
- Registrar todos los intentos con UUID; conservar aceptados, rechazados y
  conflictos sin borrar silenciosamente historia.
- Sincronización automática y manual mediante lotes idempotentes y descarga
  incremental de revocaciones.
- Detectar posteriormente dos admisiones de una entrada en puertas offline
  diferentes y conservar el conflicto como incidente auditable.
- Documentar límites de revocación y reloj sin conexión. La aceptación local
  offline no demuestra exclusión global inmediata entre puertas desconectadas.

## Administración y seguridad

- Eventos, zonas, aforos, puertas, fases de precio y asignaciones de staff.
- Ventas, disponibilidad, ingresos, reembolsos y búsqueda de entradas.
- Control de accesos, dispositivos, última sincronización, incidentes y
  auditoría administrativa, usando datos reales de la API.
- Roles asistente, staff, organizador y admin, con autorización por recurso.
- Rate limiting para autenticación y compras.
- Autor y motivo en anulaciones y reembolsos; auditoría protegida contra
  modificaciones desde la aplicación.
- Logs JSON con identificador de correlación, sin secretos.

## API, operación y rendimiento

- API REST versionada en v1; health y readiness diferenciados.
- Cursor para listados grandes.
- Explicar consistencia de la disponibilidad bajo alto tráfico, preservando
  siempre la autoridad transaccional de PostgreSQL para reservas y ventas.
- Docker Compose inicializa automáticamente API, portal, PostgreSQL,
  migraciones y el dataset original como semilla, con carga idempotente.
- Inspeccionar y sanear datos sensibles antes de publicarlos; documentar las
  adaptaciones sin simular que se procesó información no disponible.
- Secretos mediante variables de entorno, sin valores por defecto utilizables;
  `.env.example`, healthchecks e instrucciones para Expo desde dispositivo o
  emulador.
- Prueba reproducible de carga con p50 y p95 de reserva/pago, errores y ventas
  finales; justificar índices y conservar EXPLAIN de la consulta más costosa.

## Calidad y entrega

- Pruebas unitarias, de integración, de API y de concurrencia.
- Escenarios obligatorios: sobreventa; doble solicitud idempotente; expiración
  y cupo; QR antiguo; transferencia y revocación; dos puertas offline;
  reembolso usado; evento ajeno; precio manipulado; sincronización repetida.
- README de instalación/ejecución/demostración y documentos de arquitectura,
  ADR, QA, progreso y seguridad, distinguiendo implementado, probado,
  pendiente y bloqueado.
- Las decisiones significativas documentan contexto, alternativas, decisión,
  justificación, riesgos y validación.
- Los bonus son opcionales. La tabla de pesos recibida suma 120; se deja ese
  total intacto y no se atribuyen pesos individuales ausentes de esta síntesis.
- Informes por fase con objetivo, trabajo, decisiones, validación, hallazgos,
  estado y próximo paso. Sin métricas, capturas o resultados inventados.

Para términos o valores no reproducidos en esta síntesis, debe consultarse el
texto del enunciado recibido antes de atribuirle una regla exacta. La síntesis
no sustituye el original como fuente de verdad.
