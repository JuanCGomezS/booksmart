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
| Agendamiento completo | Próximo | La vista pública hoy deriva las reservas a WhatsApp. |

## Decisiones vigentes

| Decisión | Razón |
| --- | --- |
| Mantener `barbers/{id}` | Cambiar la colección separaría los datos existentes de sus citas, servicios, catálogo, productos y permisos. |
| Usar `businessType` | Generaliza el producto sin una migración destructiva. Valores: `barbershop`, `hair_salon`, `nail_studio`, `dental_clinic`, `other`. |
| Mantener rutas `/b/<slug>` | Las URLs públicas existentes no se rompen. El slug sigue siendo una identidad de negocio, no de una vertical. |
| Mantener roles heredados | `barber` y `barber_admin` permanecen como valores internos hasta una migración de permisos explícita. La UI los presenta como personal y administrador del negocio. |
| Cache con TTL | Las lecturas puntuales y el cache local reducen el consumo del plan gratuito de Firebase. |

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

- Implementar selección de servicio, profesional, fecha y hora.
- Consultar disponibilidad por negocio y por integrante del equipo.
- Registrar citas sin cuenta del cliente con estados pendientes, confirmadas, canceladas, realizadas y ausentes.
- Usar vocabulario configurable de equipo/profesional para no asumir "barbero".

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
