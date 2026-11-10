# FocusPulse — Xiaomi Smart Band 7

Desde PowerShell, en la carpeta del proyecto:

```powershell
npm.cmd install
npm.cmd exec -- zeus login
npm.cmd run preview
```

El último comando compila y muestra el QR para escanear desde el modo
desarrollador de Zepp con la pulsera vinculada.

Para compilar sin subir una vista previa:

```powershell
npm.cmd run build
```

El paquete `.zab` queda en `dist/`. Se usa Zeus CLI 1.8.2 local y el destino
`band-7`, con `deviceSource: 263` (versión internacional).
El script `scripts/zeus-band7.cjs` evita el redimensionamiento del icono cuando
el catálogo no proporciona sus dimensiones y restaura el empaquetador al terminar.
Usa los comandos npm anteriores para aplicar este ajuste.

## Integración con Android

La aplicación móvil está en la carpeta hermana `../focuspulse-mobile`. El reloj
usa el sensor HEART de Zepp OS 1.0 (o HEART_RATE si el firmware lo publica),
comprueba el estado WEAR y envía únicamente lecturas recientes. Si no hay pulso
real muestra «Sin lectura» y envía `bpm: null`. La sesión Pomodoro y sus acciones
se controlan en la pulsera; la pantalla móvil muestra el estado recibido.

El dispositivo usa `hmBle` y el servicio compañero de Zepp usa `messaging.peerSocket`.
Ambos extremos comparten un protocolo binario acotado compatible con el ejemplo
oficial MessageBuilder de Zepp. El servicio inicia sesión en Firebase con la
misma cuenta usada por la app Android, publica `session` y `readings` y recoge
`aiVerdict` cada 10 segundos. El reloj confirma la recepción del consejo para
permitir reintentos. Solo muestra «nube conectada» después de una escritura
Firebase confirmada; si no hay sincronización muestra el estado correspondiente.

En la aplicación oficial Zepp abre los ajustes de FocusPulse e introduce la URL
de Realtime Database, la Web API key pública de Firebase, el correo y contraseña
de la cuenta de prueba. La clave OpenAI no va en esos ajustes. Los datos
biométricos están protegidos por las reglas de Firebase incluidas en la carpeta
móvil. La contraseña de Firebase sí se conserva localmente en ajustes de Zepp:
para la sustentación usa una cuenta dedicada de prueba en un teléfono propio.
La antigua URL `focuspulse-default-rtdb.firebaseio.com` devolvió HTTP 404 en
la comprobación; usa la URL real que muestre tu consola Firebase.

Las pantallas de 192×490 usan fondo OLED negro, texto claro, estados de pulso y
sincronización visibles, botones de al menos 46 px de alto y confirmación háptica
inmediata. Estos son criterios de diseño basados en ISO 9241-110; la conformidad
formal requiere pruebas con usuarios y evaluación en la pulsera real.

Verificación local: `node --test tests/bridge.test.cjs` y `npm.cmd run build`.
Estas pruebas y la compilación no sustituyen la comprobación física de Bluetooth
en Zepp/Smart Band 7.
