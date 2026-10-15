# ADR 004 — SQLite, evidencia inmutable y admisión central única

**Estado:** adoptada; almacenamiento y sync implementados. Validación móvil real pendiente.

**Contexto:** miles de intentos offline, reinicios, respuestas perdidas y puertas que pueden aceptar físicamente una entrada sin comunicarse.

**Alternativas:** memoria; listas clave/valor; SQLite transaccional y UUID por intento.

**Decisión:** SQLite WAL, índices y transacción exclusiva para rechazar segunda aceptación del dispositivo y registrar cada intento. UUID estable por intento; sync central por transacción individual (máximo 500/lote), hash de payload y respuesta durable. PK evento/ticket garantiza una admisión lógica. Resultados local y central se conservan separados; segundo aceptado offline produce incidente. Auditoría e historial central append-only con triggers y permisos restringidos. Revocaciones incrementales con cursor BIGINT string y escritores serializados antes de asignar secuencia.

**Justificación:** pérdida de respuesta y reenvío no duplican; conflicto no desaparece al marcar sincronizado. Se preservan incluso tickets desconocidos. Una confirmación central no prueba orden físico.

**Riesgos:** dos puertas offline pueden admitir a la misma persona. Reloj y revocación declarados no son autoridad. Máxima antigüedad central 72 h configurable y futuro declarado 60 s. Cliente calibra con serverTime y bloquea snapshot vencido, pero necesita evidencia propia y no vuelve confiable un reloj alterado offline. Un lote parcialmente confirmado se reenvía conservando UUID. Los administradores DB pueden alterar privilegios/triggers; append-only protege rol aplicación, no superusuario.

**Validación:** doble scan local, persistencia tras reinicio y miles de filas en móvil; dos puertas offline, lote repetido, UUID/payload distinto, alcance ajeno, revocación y transferencia entre scan/sync. Intentar UPDATE/DELETE con rol runtime, probar commits de cursor fuera de orden y paginación. Evidencias ejecutadas en QA, sin equiparar tests centrales a prueba de hardware móvil.
