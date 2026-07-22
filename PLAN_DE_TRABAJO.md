# BookSmart: plan de producto

BookSmart es una plataforma de agendamiento para negocios que atienden por cita. La base actual usa Astro estático, React, Firebase y GitHub Pages con foco en controlar las lecturas de Firestore.

## Estado entregado

| Área | Estado | Alcance actual |
| --- | --- | --- |
| Marca y posicionamiento | Entregado | BookSmart habla de negocios por cita y cubre barberías, salones, estudios de uñas, clínicas dentales y otros servicios. |
| Base de URL | Entregado | Desarrollo usa `/`; producción queda preparada para `/booksmart/`. |
| Datos heredados | Entregado | Se conserva `barbers` y sus subcolecciones; `businessType` clasifica altas nuevas y los documentos históricos se leen como `barbershop`. |
| Landing | Entregado | Secciones de propuesta, funcionalidades, temas, planes y contacto. |
| Super admin | Entregado | Alta de negocios, planes, estado, métricas básicas y gestión de contenido. |
| Página pública | Entregado | Ruta dinámica `/b/<slug>` resuelta en cliente, con fallback de GitHub Pages. |
| Configuración de reservas | En progreso | Se añadieron políticas, cierres, compatibilidad servicio-profesional y horarios/descansos del personal. |
| Agendamiento completo | Próximo | La vista pública hoy deriva las reservas a WhatsApp. |

## Seguimiento de implementación

Esta es la lista operativa para marcar el avance real. Cada elemento se marca sólo cuando su comportamiento esté implementado y verificado.

### Base de producto

- [x] Rebrand de BarberFlow a BookSmart y posicionamiento para negocios por cita.
- [x] Compatibilidad con datos y rutas heredadas.
- [x] Landing, página pública y panel de super administración.
- [x] Configuración inicial de disponibilidad: políticas, cierres, compatibilidad, horarios y descansos.

### Fase 1: agendamiento universal

- [ ] Definir qué estados de cita bloquean la agenda.
- [ ] Crear el servicio seguro para calcular disponibilidad sin exponer citas.
- [ ] Crear reservas de forma atómica y evitar dobles reservas.
- [ ] Implementar el widget público: servicio, fecha, profesional y hora.
- [ ] Solicitar nombre, teléfono y consentimiento del cliente.
- [ ] Mostrar confirmación, gestionar cancelación y crear el panel administrativo de citas.
- [ ] Verificar reserva concurrente, teclado, lector de pantalla y móvil.

### Fase 2: administración del negocio

- [ ] Completar gestión de citas, servicios, equipo, catálogo, productos y configuración.
- [x] Contenido: cargar Galería y Productos bajo demanda y guardar sus imágenes en Storage.
- [x] Contenido: incorporar Servicios y Personal como cortes independientes, sin precarga; incluir identidad, estado e imágenes en Storage.
- [ ] Contenido: permitir editar de forma estructurada la descripción, precio y duración de un servicio, además de su nombre y estado.
- [ ] Exponer y editar la categoría del negocio.
- [ ] Ajustar etiquetas y experiencia según `businessType`.

### Fase 3: suscripciones y límites

- [ ] Aplicar límites de plan a personal, productos y galería.
- [ ] Bloquear escrituras al vencer el plan sin borrar datos.
- [ ] Mantener reactivación manual hasta integrar pagos.

### Fase 4: calidad y crecimiento

- [ ] Añadir SEO por negocio, estados de carga y errores.
- [ ] Revisar accesibilidad y consumo de lecturas de Firestore.
- [ ] Incorporar métricas accionables por negocio.

## Decisiones vigentes

| Decisión | Razón |
| --- | --- |
| Mantener `barbers/{id}` | Cambiar la colección separaría los datos existentes de sus citas, servicios, catálogo, productos y permisos. |
| Usar `businessType` | Generaliza el producto sin una migración destructiva. Valores: `barbershop`, `hair_salon`, `nail_studio`, `dental_clinic`, `other`. |
| Mantener rutas `/b/<slug>` | Las URLs públicas existentes no se rompen. El slug sigue siendo una identidad de negocio, no de una vertical. |
| Mantener roles heredados | `barber` y `barber_admin` permanecen como valores internos hasta una migración de permisos explícita. La UI los presenta como personal y administrador del negocio. |
| Cache con TTL | Las lecturas puntuales y el cache local reducen el consumo del plan gratuito de Firebase. |
| Reservas por servicio primero | La duración y el buffer del servicio determinan qué personal y horarios son realmente válidos. |
| Hora de Colombia para reservas | Todas las fechas y horas de reserva usan `America/Bogota`. La configuración por negocio y el soporte multi-país se difieren hasta necesitarlos explícitamente. |

## Arquitectura operativa

```text
barbers/{businessId}                    # nombre histórico de colección, no cambiar
  businessType: BusinessType             # nuevo; fallback: barbershop
  services/{serviceId}
  barbers/{staffId}                      # nombre heredado del equipo
  appointments/{appointmentId}
  catalog/{itemId}
  products/{productId}

users/{uid}
  role: client | barber | barber_admin | superadmin
  barberId?: string                      # referencia heredada al negocio
```

Los registros nuevos siempre incluyen `businessType`. Los existentes no deben migrarse en bloque para este cambio: la capa de lectura les aplica el valor `barbershop` hasta que se editen o se migren de forma explícita y verificable.

## Próximo trabajo

### Fase 1: agendamiento universal

**Objetivo:** que una persona reserve desde la página pública sin exponer citas ni datos de otros clientes.

#### Información previa y configuración

| Dato | Regla |
| --- | --- |
| Horario del negocio | Define los límites de atención y cierres excepcionales. |
| Personal | Debe estar activo y tener jornada y descansos configurados. |
| Servicios | Definen duración, buffer opcional y profesionales compatibles. |
| Políticas | Hora local de Colombia (`America/Bogota`), aviso mínimo, horizonte de reserva e intervalo de agenda. El soporte de zonas horarias por negocio o por país se difiere hasta que se necesite explícitamente. |
| Citas existentes | Sólo bloquean agenda en un servicio seguro del servidor; nunca se exponen públicamente. |

#### Experiencia de reserva

1. Elegir un servicio activo.
2. Elegir una fecha permitida.
3. Elegir un profesional compatible o **Cualquier profesional disponible**.
4. Elegir una hora válida en la agenda.
5. Ingresar nombre, teléfono y consentimiento.
6. Revisar y confirmar la solicitud.

Cada selección filtra la siguiente: el servicio restringe profesionales y duración; la fecha aplica horarios, descansos, cierres y políticas; el profesional restringe las franjas libres. Más adelante habrá una entrada secundaria por profesional, que mostrará sólo sus servicios compatibles.

La agenda debe ser usable con teclado y móvil, mostrar un paso a la vez con resumen persistente y invalidar selecciones dependientes cuando cambie servicio, fecha o profesional.

#### Cortes de entrega

| Corte | Estado | Resultado |
| --- | --- | --- |
| Configuración administrable | En progreso | Políticas de agenda, cierres, compatibilidad servicio-profesional y horarios/descansos por profesional. |
| Disponibilidad segura | Pendiente | Backend o función autenticada que calcule slots sin leer citas desde el cliente. |
| Widget público | Pendiente | Asistente servicio-primero con calendario, horas y datos básicos del cliente. |
| Confirmación y operación | Pendiente | Creación atómica, estado inicial `pending`, confirmación, cancelación y panel de citas. |

La validación final debe confirmar negocio activo, compatibilidad, horario, descansos, cierres, anticipación y ausencia de solapamientos. La creación debe ser atómica para impedir dobles reservas concurrentes.

### Fase 2: administración del negocio

- Completar el panel de citas, servicios, equipo, catálogo, productos y configuración.
- Exponer la edición de categoría de negocio en el modal administrativo.
- Ajustar etiquetas específicas de catálogo y equipo según `businessType` sin cambiar el almacenamiento heredado.
- Mantener el acceso de administradores validado contra el identificador heredado del negocio.

### Fase 3: suscripciones y límites

- Aplicar límites de plan a personal, productos y galería.
- Bloquear operaciones de escritura cuando el plan venza, sin borrar datos.
- Mantener la reactivación manual mientras no exista una pasarela de pago.

### Fase 4: calidad y crecimiento

- Metadatos SEO por negocio.
- Estados de carga, manejo de errores y revisión de accesibilidad.
- Auditoría de lecturas Firestore y cache de cada módulo.
- Métricas accionables para decisiones de cada negocio.

## Checklist de despliegue

- [ ] Renombrar el repositorio de GitHub a `booksmart` o ajustar `base` al nombre definitivo.
- [ ] Confirmar GitHub Pages con fuente GitHub Actions.
- [ ] Mantener los secretos `PUBLIC_FIREBASE_*` en el repositorio renombrado.
- [ ] Configurar canales finales de email e Instagram para BookSmart.
- [ ] Ejecutar `npm run build` antes de publicar.
- [ ] Probar una URL pública existente `/b/<slug>` después del despliegue.

## Fuera de alcance de este rebrand

- Renombrar físicamente colecciones o campos de Firestore.
- Migrar roles internos existentes.
- Inventar dominios, cuentas sociales o credenciales de BookSmart.
- Cambiar la ruta pública `/b/<slug>`.
