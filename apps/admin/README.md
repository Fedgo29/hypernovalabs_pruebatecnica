# Portal administrativo

React 19, TypeScript estricto y Vite. El portal consume exclusivamente `/v1`: los importes, el inventario, los permisos y los estados provienen del backend. No contiene datos de negocio de demostración.

Desde la raíz, `npm ci` y `npm run dev:admin` lo sirven en `http://localhost:5173`. Vite redirige `/v1` a `http://127.0.0.1:3000`. `npm run build -w @hypernova/admin` verifica tipos y produce `apps/admin/dist`. Docker sirve este resultado con Nginx en el contenedor independiente `admin`; el proxy comunica con `api:3000`.

`VITE_API_URL` es opcional y vacío por defecto. Para un backend remoto, configura su URL completa durante la construcción y habilita su origen en el CORS del backend. Un dispositivo móvil utiliza su propia configuración de Expo, no esta variable.

Acceso para cuentas `organizador` y `admin`. Las credenciales de la semilla se generan en la inicialización del backend y se obtienen por el comando documentado en el README raíz; no hay contraseñas incluidas en la interfaz.

Flujos implementados:

- Crear y editar eventos, zonas, aforos, fases de precio y puertas; asignar y retirar staff mediante listas reales de usuarios.
- Consultar ventas y disponibilidad actualizadas cada diez segundos mientras la página está visible.
- Buscar entradas por titular, comprador o identificador, con paginación por cursor. Reembolsar o anular con motivo; la clave de idempotencia se conserva durante los reintentos del diálogo.
- Consultar ingresos únicos por puerta y por hora, y dispositivos con su última sincronización y cursor de revocaciones. La ocupación registrada excluye las salidas y los ingresos aún pendientes en dispositivos sin conexión.
- Consultar incidentes con toda su evidencia, incluidos ingresos duplicados entre puertas, y el registro de auditoría protegido en el servidor.

Los importes se presentan en USD, la moneda del dataset, y se envían como enteros en centésimos. Los formularios de fecha muestran la zona horaria local del navegador y envían instantes ISO 8601.

La sesión se conserva en `sessionStorage` por pestaña; el refresh se rota y coordina para evitar renovaciones simultáneas. El cierre de sesión requiere confirmación del servidor y conserva la sesión si no puede invalidarla por un problema de red. Las comprobaciones de rol en el cliente sirven a la navegación: la API verifica nuevamente los permisos de cada recurso.

El portal incluye carga, errores reintentables y estados vacíos, listas paginadas, navegación adaptable a móvil y diálogos con foco contenido y cierre mediante Escape. Los errores de negocio conocidos se muestran en español. No se modifica ni elimina la evidencia de escaneo o auditoría desde el portal.
