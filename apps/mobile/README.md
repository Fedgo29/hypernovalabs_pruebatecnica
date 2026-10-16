# Aplicación móvil

React Native 0.81.5, React 19.1 y Expo SDK 54. Los módulos nativos están anclados a las versiones que declara `expo@54.0.37/bundledNativeModules.json`. Se requiere Expo Go compatible con SDK 54 o un development build de este proyecto; una versión de Expo Go que solo soporte otro SDK no sirve.

Desde la raíz del repositorio:

```sh
npm ci
npm run build --workspace @hypernova/contracts
docker compose up --build
```

En otra terminal, copia `apps/mobile/.env.example` a `apps/mobile/.env` y configura `EXPO_PUBLIC_API_URL` con la dirección alcanzable del backend, incluyendo `/v1`:

- Dispositivo físico: `http://IP_LAN_DEL_COMPUTADOR:3000/v1`; móvil y computador deben estar en la misma red y el firewall debe permitir el puerto.
- Emulador Android del SDK: `http://10.0.2.2:3000/v1`.
- Simulador iOS: `http://localhost:3000/v1`.
- Si cambias el puerto de la API en Compose, reemplázalo también aquí. `localhost` en un teléfono es el propio teléfono.

```sh
npm run start --workspace @hypernova/mobile
```

En Android, instala la versión compatible de Expo Go desde [expo.dev/go](https://expo.dev/go?sdkVersion=54&platform=android&device=true) y escanea el QR de Expo. Para un simulador iOS, descarga la versión compatible desde [expo.dev/go](https://expo.dev/go?sdkVersion=54&platform=ios&device=false). Pulsa `a` para abrir el emulador Android o `i` para el simulador iOS instalado. En un iPhone físico, la tienda solo ofrece la versión actual de Expo Go; si ya no soporta SDK 54, construye la app con Xcode mediante las instrucciones siguientes. Después de cambiar una variable `EXPO_PUBLIC_*`, reinicia Expo con `npx expo start --clear` desde `apps/mobile`. Esas variables son públicas: nunca coloques secretos en ellas.

Para Android, también se puede construir e instalar un APK de desarrollo local con Android Studio, Android SDK y JDK 17 configurados. Inicia el emulador desde Android Studio o conecta un teléfono por USB con depuración habilitada y autorización de ADB. Comprueba que `adb devices` lo muestre; después:

```sh
cd apps/mobile
npx expo run:android
```

Para iOS, se requiere macOS con Xcode y sus herramientas de línea de comandos. Inicia un simulador y ejecuta desde `apps/mobile`:

```sh
npx expo run:ios
```

Para un iPhone físico, configura la firma y el equipo de desarrollo en Xcode y usa `npx expo run:ios --device`. La firma de Apple requiere la configuración propia del desarrollador.

Esos comandos generan proyectos nativos locales. No hay un APK o IPA verificado en esta entrega. La ejecución real de cámara, SecureStore, SQLite y modo avión exige un dispositivo o emulador; el typecheck y la exportación de bundles no la sustituyen.

## Flujos

La pestaña Eventos obtiene eventos, zonas, disponibilidad y precios de la API. La reserva usa un UUID de idempotencia persistido por operación; el contador y el UUID del pago se guardan en SQLite para sobrevivir al reinicio. Reintentar una respuesta perdida conserva la misma clave. Un pago tardío muestra la resolución devuelta por el servidor.

La billetera guarda los metadatos y la credencial firmada en SQLite. Abre cada entrada al menos una vez con conexión antes de activar modo avión. El dispositivo genera la semilla Ed25519 con `expo-crypto` y la guarda en SecureStore; solo envía su clave pública a la API. El código QR prueba posesión de la clave del titular y cambia cada 25 segundos. La firma se calcula una vez por ventana temporal, mediante `useMemo`, en lugar de cada render. La lista de entradas usa `FlatList`.

Las transferencias se inician desde la entrada y se aceptan o cancelan en Transferir. La API decide permisos, plazos y estados. Al actualizar la billetera, las entradas que ya pertenecen a otra cuenta desaparecen del caché; las credenciales de entradas usadas, reembolsadas o anuladas dejan de mostrarse. Un dispositivo que sigue completamente desconectado todavía conserva el último estado conocido.

El staff inicia turno seleccionando evento y puerta con conexión. La API valida la asignación y entrega claves públicas y revocaciones. Cada intento recibe un UUID, incluyendo rechazos. Un índice en SQLite y una transacción exclusiva detectan localmente entradas ya admitidas. La cámara se pausa entre lecturas para evitar que el mismo fotograma genere continuamente intentos.

Los intentos pendientes sobreviven a reinicios. La sincronización automática se intenta cada 20 segundos mientras está abierto el modo escáner y al volver al primer plano; también puede iniciarse manualmente. Sube lotes de 100 agrupados por turno, conserva los intentos hasta recibir confirmación y después descarga revocaciones por cursor. Se conservan el resultado local, el resultado del servidor, el cursor de revocación y la antigüedad del último snapshot. El servidor registra los conflictos entre puertas como incidentes; la app muestra la cantidad reportada.

No se permite cambiar de puerta con intentos pendientes. El rechazo local de duplicados se aplica a toda la instalación para el evento, incluso si se cambia de puerta o cuenta. Antes de un turno se verifica que el reloj difiera menos de un minuto del servidor y se conserva la diferencia para validar y registrar escaneos con hora calibrada. La sincronización recalibra esa diferencia. Activa siempre la fecha y hora automáticas: no es posible probar la honestidad de un reloj completamente desconectado. Tras superar la antigüedad máxima offline indicada por el servidor, el escáner requiere sincronización. Las puertas desconectadas no comparten estado: la prevención local y la detección posterior del conflicto no garantizan impedir físicamente dos ingresos simultáneos en puertas aisladas.

## Validación reproducible

```sh
npm run test --workspace @hypernova/contracts
npm run typecheck --workspace @hypernova/mobile
npm run export --workspace @hypernova/mobile
```

Las pruebas de contratos usan claves aleatorias nuevas en cada ejecución y verifican firma del emisor, posesión del titular, ventana temporal, revocación, evento, zona, rechazo de manipulación y campos adicionales. La exportación genera bundles para Android e iOS. Los resultados reales y lo pendiente se registran en la documentación de QA del repositorio.

Para validar el modo avión en un dispositivo: prepara billetera y turno con red; activa modo avión; escanea una entrada válida y repítela; muestra un QR guardado hace un minuto; reinicia la app y comprueba que el duplicado sigue rechazándose. Para el conflicto entre puertas, prepara dos dispositivos distintos con la misma entrada, admite offline en ambos y sincroniza ambos; el segundo debe aparecer como incidente en el portal.
