# TimeGuard — PRD vivo

## Problema
Las familias necesitan acompañar el tiempo de pantalla de varios dispositivos Android con límites claros, contexto de uso y solicitudes de tiempo, sin una experiencia punitiva.

## Arquitectura
- Expo SDK 54 + React Native, navegación por tabs en una pantalla móvil.
- Supabase Auth email/password, PostgreSQL relacional, RLS y Realtime como fuente de verdad.
- FastAPI queda reservado para ingestión segura de uso Android, validación de dispositivos y operaciones server-side.
- `app/supabase/schema.sql` contiene perfiles, familias, miembros, dispositivos, sesiones, uso por app, límites, apps gestionadas, horarios, solicitudes y notificaciones.

## Personas
- Padre/administrador: crea la familia, vincula dispositivos, define límites y decide solicitudes.
- Niño/adolescente monitorizado: recibe límites, estado de bloqueo y puede pedir más tiempo.

## Requisitos principales
- Registro e inicio de sesión con Supabase Auth.
- Panel familiar con tiempo diario, dispositivos y navegación Resumen / Actividad / Controles / Ajustes.
- Vinculación por código de emparejamiento y superficie preparada para QR.
- Límites diarios, bloqueo configurable, apps permitidas y base de horarios.
- Realtime para cambios de dispositivos.
- RLS por pertenencia a familia.
- Diseño cálido, accesible, en español y sin imágenes de terceros.

## Implementado — 2026-08-19 (actualización 5)
- Sincronización automática del uso real (dispositivo monitorizado):
  - Primer plano: intervalo cada 3 min que llama a `syncUsageToSupabase` mientras la app está abierta (solo si hay permiso de "Acceso de uso").
  - Segundo plano: tarea `expo-background-task` (`src/lib/backgroundSync.ts`, definida en `_layout.tsx`) registrada con `minimumInterval` 15 min (mínimo del SO); restaura sesión anónima + device id desde almacenamiento y sincroniza. Best-effort controlado por el SO.
  - Se elimina el registro al desvincular. Guardado para web/Expo Go: todo inerte (usageAvailable=false), sin crash.
- Nota UI: el panel nativo indica "Se sincroniza automáticamente cada pocos minutos y en segundo plano".
- Limitación: la sincronización real y la ejecución en segundo plano SOLO ocurren en un dev build de Android (no en Expo Go / web). El intervalo real en background lo decide el SO (≈15 min o más).
- Retest (iteration_9): regresión de arranque, pantalla monitorizada, solicitudes, desvincular y bloqueo por horario → ALL PASS, 0 errores.

## Implementado — 2026-08-19 (actualización 4)
- Bloqueo por HORARIO (lógica JS, `src/lib/schedule.ts`): si hay franjas habilitadas y la hora actual queda fuera de todas, el dispositivo monitorizado muestra pantalla "Fuera del horario" con próxima franja; si está dentro, muestra "Dentro de tu horario". El bloqueo manual del padre tiene prioridad. Se re-evalúa cada 30s y por Realtime.
- Módulo nativo Android local `modules/timeguard-usage` (Expo Modules API, Kotlin):
  - `UsageStatsManager` para medir minutos por app (`getUsage`), permiso "Acceso de uso" (`hasUsageAccess`/`openUsageAccessSettings`).
  - `BlockerAccessibilityService` que, con el bloqueo activo, envía al inicio cualquier app no permitida (`setBlocking`, `isAccessibilityEnabled`/`openAccessibilitySettings`).
- Puente JS `src/lib/nativeUsage.ts` con `requireOptionalNativeModule`: en Expo Go/web devuelve null y la app degrada sin romperse (aviso "Se activan al instalar el build de Android"). En dev build, la pantalla monitorizada muestra permisos + "Sincronizar uso ahora" que escribe `app_usage`/`device_sessions` en Supabase, y aplica el enforcement.
- app.json: permiso CAMERA + plugin expo-camera (ya presentes); PACKAGE_USAGE_STATS ya declarado.
- IMPORTANTE: medición real de apps, escaneo QR por cámara y bloqueo por accesibilidad SOLO funcionan en un dev build de Android instalado en dispositivo físico (no en Expo Go / vista previa web).
- Retest (iteration_8): fallback nativo, bloqueo por horario (dentro/fuera), prioridad del bloqueo manual y regresión de solicitudes → ALL PASS.

## Implementado — 2026-08-19 (actualización 3)
- Pantalla inicial con elección de rol: "Soy padre/madre" y "Soy el dispositivo monitorizado".
- Emparejamiento REAL: el padre genera un código de un solo uso con caducidad de 10 min + QR (con cuenta atrás). El dispositivo monitorizado se une con auth anónima introduciendo el código (o escaneando el QR con la cámara en el build Android).
- Función Postgres `redeem_pairing_code` (SECURITY DEFINER, `#variable_conflict use_column`) que valida (no encontrado / usado / caducado), crea el dispositivo, une al usuario anónimo a la familia y crea su límite. Reuso de código bloqueado.
- Pantalla del dispositivo monitorizado: estado, pantalla de bloqueo amigable, botón "Pedir 30 min más" (crea solicitud real), estado de solicitudes y Realtime.
- Controles ampliados: selector de dispositivo (chips), tipo de perfil (niño/adolescente/personalizado) persistido, límite diario persistido en `device_limits`, y gestión de HORARIOS por dispositivo (añadir/activar/eliminar) con validación HH:MM.
- Trigger `handle_new_user` a prueba de fallos (permite usuarios anónimos). Permiso de cámara y plugin expo-camera añadidos en app.json.
- Refactor: pantallas separadas en `src/screens/*` y router limpio en `app/index.tsx`.
- Retest (iteration_7): landing, login, emparejamiento, unión desde 2º dispositivo (código de un solo uso), flujo de solicitudes padre↔monitorizado, perfiles/horarios/límite → ALL PASS.

## Implementado — 2026-08-19 (actualización 2)
- Solicitudes de tiempo extra completas y verificadas end-to-end: crear (simulate-request), listar con badge de pendientes, aprobar (APROBADA) y denegar (DENEGADA), con persistencia en Supabase y Realtime.
- Esquema Supabase reparado y ejecutado por el usuario: se corrigió el drift (tablas y columnas faltantes + columnas legacy NOT NULL en `devices`). Ahora las 11 tablas y sus columnas responden 200 y los INSERT respetan RLS.
- `supabase/schema.sql` ahora es idempotente (tablas, columnas, políticas y publicación Realtime re-ejecutables sin error).
- Cuenta de prueba creada y documentada en `/app/memory/test_credentials.md` (padre.test@timeguard.dev). Confirmación de email desactivada en el proyecto.
- Refresco Realtime silencioso (sin parpadeo del spinner) y errores reales de Supabase visibles en pantalla y en el modal de vinculación (pairing-error).
- Retest completo (iteration_6): login, tabs, vinculación, bloqueo persistente, solicitudes y cierre de sesión → ALL PASS.

## Implementado — 2026-08-19
- Acceso Supabase funcional con persistencia de sesión y validación local.
- Dashboard móvil TimeGuard con estados vacío, resumen, actividad, controles y ajustes.
- Conexión a familias/dispositivos/sesiones Supabase, creación inicial de familia y suscripción Realtime.
- Modal de código de emparejamiento, controles de límite/bloqueo y cierre de sesión.
- Esquema PostgreSQL con RLS y tablas de producto en `app/supabase/schema.sql`.
- Variables públicas Supabase configuradas para Expo y permisos Android base declarados.
- Verificado: preview móvil sin overflow; error de credenciales devuelve respuesta real de Supabase, no error de red; TypeScript y lint sin errores.

## Pendiente priorizado
- P0: Ejecutar `supabase/schema.sql` en el proyecto Supabase y validar un usuario de prueba no productivo.
- P0: Añadir ingestión Android real con `UsageStatsManager`, cola offline y desarrollo nativo.
- P0: Definir estrategia de enforcement: AccessibilityService con consentimiento o device-owner para bloqueo fuerte.
- P1: Implementar scanner/generador QR nativo y pairing seguro de un solo uso.
- P1: Persistir y mostrar límites, solicitudes y apps gestionadas desde las pantallas actuales.
- P1: Añadir pantalla monitorizada independiente, alertas y aprobación/denegación de solicitudes.
- P2: Push notifications FCM, Storage de avatares y reportes semanales exportables.

## Próximas tareas
1. Ejecutar el SQL en Supabase Dashboard.
2. Crear una cuenta de prueba y revisar RLS entre dos familias.
3. Construir el módulo Android nativo en development build con un dispositivo físico.
4. Completar solicitudes de más tiempo y sincronización Realtime de límites.