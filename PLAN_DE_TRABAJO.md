# BarberFlow — Plan de Desarrollo

Plataforma multi-barbería construida sobre Astro (estático) + Firebase + GitHub Pages. **100% gratuita en infraestructura.**

---

## ⚠️ Restricciones del plan gratuito de Firebase (Spark)

Este proyecto vive ENTERO en el plan gratuito de Firebase. Eso no es negociable, por lo tanto **cada lectura a Firestore cuenta**.

### Límites del plan Spark

| Recurso | Límite diario gratuito |
|---|---|
| Lecturas Firestore | **50.000 / día** |
| Escrituras Firestore | 20.000 / día |
| Eliminaciones Firestore | 20.000 / día |
| Storage almacenado | 5 GB total |
| Storage descarga | 1 GB / día |
| Cloud Functions invocaciones | 125.000 / mes |
| Auth usuarios | Ilimitado |

### Por qué 50.000 lecturas diarias ES suficiente — si se usa bien

Con 10 barberías activas y 50 visitas por barbería por día (500 sesiones/día), tenés 100 lecturas "libres" por sesión antes de agotar el cupo. Eso es MÁS que suficiente si se aplica la estrategia de cache correcta. Si se hace mal, 3 barberías con tráfico normal pueden tirar el sistema.

### Estrategia de lectura — reglas obligatorias

Estas reglas NO son opcionales. Son parte de la arquitectura:

#### 1. Cache en localStorage con TTL

Todo dato que cambia poco **debe** venir de localStorage antes de ir a Firestore.

| Dato | TTL sugerido | Razón |
|---|---|---|
| Config de la barbería | 1 hora | Cambia solo cuando el admin edita |
| Lista de servicios | 1 hora | Cambios poco frecuentes |
| Lista de barberos | 30 min | Puede cambiar disponibilidad |
| Catálogo de fotos | 2 horas | Raramente cambia |
| Productos | 30 min | Stock puede variar |

```ts
// Patrón a seguir en toda lib que lea Firestore
export async function getBarberConfig(barberId: string): Promise<Barber> {
  const cacheKey = `barber_config_${barberId}`;
  const cached = localStorage.getItem(cacheKey);

  if (cached) {
    const { data, expiresAt } = JSON.parse(cached);
    if (Date.now() < expiresAt) return data;  // ← 0 lecturas Firestore
  }

  const snap = await getDoc(doc(db, 'barbers', barberId));  // ← 1 lectura
  const data = snap.data() as Barber;
  localStorage.setItem(cacheKey, JSON.stringify({
    data,
    expiresAt: Date.now() + 60 * 60 * 1000  // 1 hora
  }));
  return data;
}
```

#### 2. Nunca usar `onSnapshot` para datos estáticos

`onSnapshot` abre un listener en tiempo real. Cada cambio en el documento dispara una lectura. Para datos como la config de la barbería, el catálogo o los servicios, **usar `getDoc` (lectura única) + cache**. Reservar `onSnapshot` solo para:
- Citas del día en el panel admin (donde el tiempo real tiene valor real)
- Nada más

#### 3. Queries específicas, nunca colecciones completas

```ts
// ❌ MAL — lee todos los appointments de la barbería
getDocs(collection(db, 'barbers', barberId, 'appointments'))

// ✅ BIEN — solo los del día de hoy
const start = startOfDay(new Date());
const end = endOfDay(new Date());
getDocs(query(
  collection(db, 'barbers', barberId, 'appointments'),
  where('date', '>=', start),
  where('date', '<=', end)
))
```

#### 4. Invalidar cache solo cuando hace falta

Cuando el admin guarda cambios, invalidar el cache de ese dato específico en localStorage. No hacer flush de todo.

```ts
// Después de guardar config:
localStorage.removeItem(`barber_config_${barberId}`);
```

#### 5. Índice de barberías sin leer documentos individuales

Para la landing y el super admin, evitar leer cada documento de barbería por separado. Mantener un documento `_index` o usar queries paginadas con `limit`.

#### 6. Storage: servir imágenes por URL directa

Las URLs de Firebase Storage son permanentes y públicas. **Guardar la URL en Firestore, no leer el archivo en cada visita.** Subir una vez, usar la URL para siempre.

### Monitoreo

- Activar **Firebase Usage & Billing alerts** en la consola desde el día 1
- Revisar **Firestore → Usage** semanalmente durante el primer mes
- Si una barbería supera lecturas esperadas, revisar si tiene `onSnapshot` mal usado

---

## Stack

| Capa | Tecnología |
|---|---|
| Framework | Astro 6.x (output: static) |
| UI | React 19.x con `client:load` |
| Tipado | TypeScript 5.x |
| Estilos | Tailwind CSS 4.x |
| Auth + DB + Storage | Firebase (client SDK 12.x) |
| Backend serverless | Firebase Cloud Functions 7.x (Node 24) — solo si se necesita lógica crítica |
| Despliegue | GitHub Pages via GitHub Actions |

---

## Regla de arquitectura UI: .astro vs .tsx

Para mantener el proyecto simple, rápido y sostenible, se define esta regla obligatoria:

### Usar `.astro` cuando

- La sección es mayormente estática (landing, marketing, textos, bloques visuales)
- Se prioriza SEO, performance y mínimo JavaScript en cliente
- No hay estado complejo ni listeners en tiempo real

### Usar `.tsx` (React) cuando

- Hay lógica de interacción compleja o múltiples estados acoplados
- Se necesita integración directa con Firebase Auth/Firestore en cliente
- Hay formularios complejos, paneles administrativos o flujos tipo wizard
- Se requiere tiempo real (`onSnapshot`) o UI altamente reactiva

### Regla práctica para este proyecto

- Landing pública: se mantiene en `.astro`
- Super admin, app de barbería y paneles de gestión: se implementan en `.tsx`
- Composición de página: Astro como contenedor + React con `client:load` solo donde aporte valor

---

## Modelo de rutas

```
/                      → Landing pública del producto (BarberFlow)
/login                 → Login super admin
/admin                 → Dashboard super admin (gestión de barberías)
/b/[barberId]          → App dinámica de la barbería (SPA client-side)
```

La ruta `/b/[barberId]` se resuelve con una sola página `src/pages/b/[...slug].astro` que delega todo al cliente. No se recompila por cada barbería nueva.

---

## Modelo de datos Firestore

```
barbers/{barberId}
  ├── name: string
  ├── slug: string              # identificador en URL: /b/abc123
  ├── ownerId: string           # uid del admin de la barbería
  ├── plan: 'standard' | 'plus' | 'extra'
  ├── billingCycle: 'month_1' | 'month_3' | 'month_12'
  ├── trialStartedAt: Timestamp
  ├── trialEndsAt: Timestamp
  ├── trialUsed: boolean
  ├── planExpiresAt: Timestamp
  ├── active: boolean
  ├── limits: {
  │     maxBarbers: number
  │     maxProducts: number
  │     maxGalleryItems: number
  │   }
  ├── config: {
  │     address: string
  │     phone: string
  │     logoUrl: string
  │     coverUrl: string
  │     socialLinks: { instagram?, facebook?, whatsapp? }
  │     theme: { primaryColor: string }
  │   }
  ├── workingHours: {
  │     [day: 0-6]: { open: string, close: string, enabled: boolean }
  │   }
  │
  ├── services/{serviceId}      # cortes y servicios
  │     ├── name: string
  │     ├── description: string
  │     ├── duration: number    # minutos
  │     ├── price: number
  │     └── imageUrl?: string
  │
  ├── barbers/{barberId}        # subcolección de barberos del local
  │     ├── name: string
  │     ├── photoUrl?: string
  │     ├── active: boolean
  │     └── availability: {    # disponibilidad por día
  │           [day: 0-6]: { slots: string[] }
  │         }
  │
  ├── appointments/{appointmentId}
  │     ├── clientName: string
  │     ├── clientPhone: string
  │     ├── barberId: string
  │     ├── serviceId: string
  │     ├── extraServices: string[]
  │     ├── date: Timestamp
  │     ├── status: 'pending' | 'confirmed' | 'cancelled' | 'done'
  │     └── notes?: string
  │
  ├── catalog/{itemId}          # catálogo de cortes (galería)
  │     ├── title: string
  │     ├── imageUrl: string
  │     └── tags: string[]
  │
  └── products/{productId}      # productos en venta
        ├── name: string
        ├── description: string
        ├── price: number
        ├── stock: number
        ├── imageUrl?: string
        └── active: boolean

users/{uid}
  ├── email: string
  ├── role: 'superadmin' | 'barber_admin'
  └── barberId?: string         # solo para admins de barbería
```

### Reglas de Firestore (principios)

- Lectura pública de `barbers/{id}` y sus subcolecciones (catalog, services, barbers).
- Escritura de `appointments` permitida sin auth (clientes no se registran).
- `products` lectura pública, escritura solo admin.
- Todo lo demás requiere auth con claim/rol correspondiente.

---

## Estructura de directorios

```
barberflow/
├── src/
│   ├── components/
│   │   ├── home/              # Secciones de la landing
│   │   │   ├── HeroSection.astro
│   │   │   ├── FeaturesSection.astro
│   │   │   ├── PricingSection.astro
│   │   │   └── ContactSection.astro
│   │   └── react/
│   │       ├── barber/        # App cliente de la barbería
│   │       │   ├── BarberApp.tsx          # Root: resolve barberId, carga config
│   │       │   ├── BookingFlow.tsx        # Agendamiento paso a paso
│   │       │   ├── CatalogGallery.tsx
│   │       │   ├── ProductsShop.tsx
│   │       │   └── LocationMap.tsx
│   │       ├── admin/         # Admin de barbería
│   │       │   ├── AdminApp.tsx
│   │       │   ├── AppointmentsPanel.tsx
│   │       │   ├── CatalogManager.tsx
│   │       │   ├── ProductsManager.tsx
│   │       │   ├── ServicesManager.tsx
│   │       │   ├── BarbersManager.tsx
│   │       │   └── ScheduleManager.tsx
│   │       └── superadmin/    # Super admin
│   │           ├── SuperAdminApp.tsx
│   │           └── BarberiesControl.tsx
│   ├── layouts/
│   │   ├── Layout.astro       # Layout base con head y meta
│   │   └── BarberLayout.astro # Layout dinámico (logo/tema de la barbería)
│   ├── lib/
│   │   ├── firebase.ts        # Init: db, auth, storage
│   │   ├── types.ts           # Todos los tipos de dominio
│   │   ├── auth.ts            # Login, logout, onAuthStateChanged
│   │   ├── barbers.ts         # CRUD barberías
│   │   ├── appointments.ts    # CRUD citas
│   │   ├── catalog.ts         # CRUD catálogo
│   │   ├── products.ts        # CRUD productos
│   │   ├── services.ts        # CRUD servicios/cortes
│   │   ├── planLimits.ts      # Verificación de plan activo
│   │   └── utils.ts           # getRoute(), formatDate(), etc.
│   ├── pages/
│   │   ├── index.astro        # Landing del producto
│   │   ├── login.astro        # Login super admin
│   │   ├── admin.astro        # Dashboard super admin
│   │   └── b/
│   │       └── [...slug].astro  # Catch-all: app de barbería + admin
│   └── styles/
│       ├── global.css
│       └── theme.css
├── functions/                 # Solo si se necesita lógica server-side
├── public/
├── scripts/                   # Seed y scripts admin con firebase-admin
├── .github/
│   └── workflows/
│       └── deploy.yml
├── astro.config.mjs
├── firebase.json
├── .firebaserc
└── tsconfig.json
```

---

## Etapas de desarrollo

---

### Etapa 0 — Setup inicial

**Objetivo:** repo listo, proyecto Astro corriendo, Firebase conectado.

#### 0.1 Crear repositorio GitHub
- [ ] Crear repo `barberflow` en GitHub (público para GitHub Pages gratis)
- [ ] Habilitar **Settings → Pages → Source: GitHub Actions**
- [ ] Clonar local

#### 0.2 Inicializar proyecto Astro
```bash
npm create astro@latest barberflow -- --template minimal --typescript strict --no-git
cd barberflow
npx astro add react
npm install @tailwindcss/vite tailwindcss
npm install firebase
```

#### 0.3 Configurar `astro.config.mjs`
```js
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';

export default defineConfig({
  site: 'https://<usuario>.github.io',
  base: '/barberflow/',
  vite: { plugins: [tailwindcss()] },
  integrations: [react()]
});
```

#### 0.4 Firebase Console
- [X] Crear proyecto en [Firebase Console](https://console.firebase.google.com)
- [X] Habilitar **Authentication → Email/Password**
- [X] Habilitar **Firestore** (modo producción)
- [X] Habilitar **Storage** (para logos, imágenes de catálogo, productos)
- [X] Copiar config SDK → crear `.env`

```env
PUBLIC_FIREBASE_API_KEY=...
PUBLIC_FIREBASE_AUTH_DOMAIN=...
PUBLIC_FIREBASE_PROJECT_ID=...
PUBLIC_FIREBASE_STORAGE_BUCKET=...
PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
PUBLIC_FIREBASE_APP_ID=...
PUBLIC_FIREBASE_MEASUREMENT_ID=...
```

#### 0.5 `src/lib/firebase.ts`
Init de Firebase siguiendo el patrón del doc de arquitectura (db, auth, storage).

#### 0.6 CI/CD — `.github/workflows/deploy.yml`
- [ ] Workflow: checkout → setup-node 22 → npm install → astro build → upload-pages-artifact → deploy-pages
- [ ] Agregar los 6 secrets `PUBLIC_FIREBASE_*` en GitHub Secrets
- [ ] Verificar primer deploy exitoso

**Entregable:** `https://<usuario>.github.io/barberflow/` con página en blanco funcionando.

---

### Etapa 1 — Landing pública (Home)

**Objetivo:** página de marketing de BarberFlow completamente estática.

#### Secciones (`.astro` — sin interactividad React)
- [ ] **HeroSection** — nombre, tagline, CTA "Empezá gratis 15 días"
- [ ] **FeaturesSection** — qué ofrece (agenda, catálogo, productos, métricas)
- [ ] **PricingSection** — tabla de planes

| Plan | Duración | Precio |
|---|---|---|
| Estándar | 1 / 3 / 12 meses | $ TBD |
| Plus | 1 / 3 / 12 meses | $ TBD |
| Extra | 1 / 3 / 12 meses | $ TBD |

#### Definición comercial de planes (orientado a venta y rentabilidad)

#### Prueba gratuita (15 días)

- La prueba es por barbería creada (no global por dueño).
- Cada nueva barbería arranca con `trialEndsAt = createdAt + 15 días`.
- Durante la prueba tiene acceso completo al nivel Estándar para validar operación real.
- Una vez usada la prueba de esa barbería, no se reinicia automáticamente.
- Si el mismo dueño crea otra barbería, esa nueva barbería también inicia su propio período de prueba de 15 días.

**Estándar**
- Incluye: agenda, citas, horarios, servicios base, pocos barberos, datos básicos del negocio y página pública simple.
- Objetivo: resolver la operación mínima de una barbería pequeña.
- Limitaciones: menor cantidad de barberos, menor cupo de productos y galería, funciones comerciales avanzadas no incluidas.

**Plus**
- Incluye: todo Estándar + galería, branding, productos, más barberos, gestión de clientes y recordatorios.
- Objetivo: vender mejor y verse más profesional.
- Limitaciones: límites superiores a Estándar pero menores a Extra en barberos, productos, galería y automatizaciones.

**Extra**
- Incluye: todo Plus + reportes, métricas, historial de clientes, control avanzado, exportación, analítica y herramientas de crecimiento.
- Objetivo: dar control real del negocio al dueño.
- Limitaciones: plan tope operativo (sin límites funcionales críticos en comparación con Plus).

Todos los planes mantienen ciclos de facturación de **1, 3 y 12 meses**.

#### ¿Qué pasa cuando termina la prueba?

- Si no se asigna plan pago al vencer los 15 días, la barbería pasa a estado **expirada**.
- En estado expirada:
  - La página pública puede mostrarse en modo limitado o con aviso de plan vencido.
  - El panel admin queda en solo lectura (sin crear/editar citas, servicios o productos).
  - No se elimina información histórica.
- Al activar un plan (Estándar, Plus o Extra), se reactiva el acceso normal sin perder datos.

#### Cambios de plan (upgrade/downgrade)

- El usuario puede cambiar de plan en cualquier mes, tanto para subir (upgrade) como para bajar (downgrade).
- Upgrade: se aplica inmediatamente y se recalculan límites del nuevo plan.
- Downgrade: puede aplicarse al siguiente ciclo de facturación para evitar corte brusco de operación.
- Si al bajar de plan supera límites (por ejemplo barberos/productos), el sistema entra en modo ajuste: no permite crear nuevos ítems hasta volver al límite.
- Toda transición de plan se registra en historial para trazabilidad administrativa.

- [ ] **ContactSection** — email / WhatsApp / formulario estático (Formspree o similar, gratis)
- [ ] **Footer** — links, redes, aviso legal

**Entregable:** landing responsive con Tailwind, sin Firebase en esta página.

---

### Etapa 2 — Super Admin

**Objetivo:** panel para gestionar todas las barberías del sistema.

#### 2.1 Autenticación
- [ ] `src/pages/login.astro` con `<LoginForm client:load />`
- [ ] `src/lib/auth.ts`: `signInWithEmailAndPassword`, `signOut`, `onAuthStateChanged`
- [ ] Custom claim `role: 'superadmin'` (se setea con script de seed o Cloud Function)
- [ ] `<AuthGuard>` que verifica claim y redirige si no tiene acceso

#### 2.2 Dashboard super admin — `/admin`
- [ ] `src/pages/admin.astro` → `<SuperAdminApp client:load />`
- [ ] Lista de barberías con estado: activa / trial / expirada
- [ ] Crear barbería (genera `barberId` Firestore + configura `ownerId`)
- [ ] Editar plan y fecha de expiración
- [ ] Activar / desactivar acceso
- [ ] Ver métricas básicas: citas del mes, productos activos

**Entregable:** super admin puede crear y gestionar barberías desde el dashboard.

---

### Etapa 3 — Routing dinámico de barberías

**Objetivo:** una sola página Astro que sirve toda la app de cada barbería.

#### 3.1 `src/pages/b/[...slug].astro`
```astro
---
// Sin getStaticPaths — el slug se resuelve en cliente
---
<Layout>
  <BarberApp client:load />
</Layout>
```

#### 3.2 `BarberApp.tsx` — resolución client-side
```ts
// Lee window.location.pathname → extrae barberId
// Busca barbers/{barberId} en Firestore
// Si no existe → 404 component
// Si plan expirado → PlanExpired component
// Si ok → renderiza la app de la barbería con su config
```

#### 3.3 Vistas públicas de la barbería
- [ ] **Página principal** — logo, nombre, dirección, redes, horario
- [ ] **Agendamiento** — flujo de reserva (ver Etapa 4)
- [ ] **Catálogo** — galería de cortes con tags
- [ ] **Productos** — tienda básica (sin carrito real, solo contacto)
- [ ] **Ubicación** — embed de Google Maps con la dirección

#### 3.4 Navegación interna de la barbería
Tabs o nav inferior: Inicio / Agendar / Catálogo / Productos / Ubicación

**Nota sobre 404 en GitHub Pages:** agregar `404.html` que redirige al `index.html` con el path en sessionStorage. Patrón estándar para SPA en GitHub Pages.

**Entregable:** `/b/abc123` carga la barbería correcta desde Firestore.

---

### Etapa 4 — Agendamiento de citas

**Objetivo:** flujo completo de reserva para el cliente final (sin cuenta, sin login).

#### Flujo paso a paso (wizard)
1. **Seleccionar servicio** — lista de servicios con duración y precio
2. **Seleccionar barbero** — con foto y disponibilidad
3. **Seleccionar fecha y hora** — calendario que excluye slots ocupados y días no laborales
4. **Servicios extra** — checkbox de add-ons opcionales
5. **Datos del cliente** — nombre + teléfono (sin email obligatorio)
6. **Confirmación** — resumen + botón "Confirmar cita"

#### Lógica de disponibilidad (client-side)
- Obtener `workingHours` de la barbería
- Obtener `availability` del barbero seleccionado
- Obtener citas existentes del día en Firestore (query en tiempo real)
- Calcular slots libres restando ocupados y respetando `duration` del servicio
- Detectar solapamientos: `slot.start + service.duration <= nextAppointment.start`

#### Escritura en Firestore
```
barbers/{barberId}/appointments/{autoId}
  status: 'pending'
  createdAt: serverTimestamp()
```

#### Gestión de ausencias, cancelaciones y reactivación

- Recordatorios de cita previos por WhatsApp.
- Confirmación de asistencia por WhatsApp.
- Estados de cita claros: pendiente, confirmada, cancelada, realizada, ausente.
- Detección de clientes con cancelaciones frecuentes para seguimiento.
- Flujo de reactivación comercial: "hace 3 semanas no vienes, agenda de nuevo".

**No se requiere auth del cliente.** Las reglas de Firestore permiten escritura en esta subcolección sin login.

**Entregable:** cliente puede reservar cita sin crear cuenta. Admin la ve en su panel.

---

### Etapa 5 — Panel Admin de barbería

**Objetivo:** el dueño de la barbería gestiona todo desde `/b/{barberId}/admin`.

#### 5.1 Ruta de admin
La misma página `[...slug].astro` detecta si el path incluye `/admin` y verifica auth.

#### 5.2 Autenticación del admin de barbería
- Login con email/password (misma página `/login` o modal)
- Verificar `users/{uid}.barberId === barberId` de la URL
- Si no coincide → acceso denegado

#### 5.3 Módulos del panel

**Citas**
- [ ] Vista de calendario: día / semana
- [ ] Cambiar estado: pendiente → confirmada → realizada / cancelada
- [ ] Filtrar por barbero
- [ ] Alertas de solapamiento

**Catálogo**
- [ ] Subir imágenes a Firebase Storage (`barbers/{id}/catalog/`)
- [ ] Agregar título y tags
- [ ] Reordenar y eliminar

**Productos**
- [ ] CRUD completo con imagen, precio y stock
- [ ] Activar / desactivar sin borrar

**Servicios y cortes**
- [ ] CRUD de servicios: nombre, descripción, duración, precio
- [ ] Catálogo de servicios y extras bien armado (barba, cejas, tratamiento, combo, etc.)
- [ ] Duración impacta directamente en el calendario de citas

**Barberos**
- [ ] Agregar barbero con foto
- [ ] Definir disponibilidad por día (horario y slots)
- [ ] Activar / desactivar sin perder historial

**Configuración general**
- [ ] Editar nombre, dirección, teléfono, redes sociales
- [ ] Subir logo y cover
- [ ] Definir horario del local
- [ ] Color primario (theme básico)

**Clientes y crecimiento**
- [ ] Historial de clientes: quién vino, qué servicio tomó, con qué barbero y cuánto gastó
- [ ] Segmentación básica para campañas de reactivación

**Permisos y roles (escalabilidad)**
- [ ] Roles internos por barbería: owner, admin, barber
- [ ] Permisos por módulo según rol

**Entregable:** admin puede gestionar toda su barbería sin tocar código.

---

### Etapa 6 — Límites de plan y control de acceso

**Objetivo:** que las barberías con plan vencido no puedan usar el sistema.

#### `src/lib/planLimits.ts`
```ts
export function isPlanActive(barber: Barber): boolean {
  // plan: standard | plus | extra
  // billingCycle: month_1 | month_3 | month_12
  // trial: 15 días por barbería
  return barber.planExpiresAt > now && barber.active
}
```

#### Reglas de negocio de membresías

- Cada barbería tiene una prueba gratuita de 15 días (desde `trialStartedAt` hasta `trialEndsAt`).
- Al finalizar la prueba sin plan activo, queda en estado expirada con acceso limitado.
- El dueño puede cambiar de plan en cualquier mes (upgrade/downgrade).
- Upgrade se aplica de inmediato; downgrade puede programarse al próximo ciclo.
- Nunca se borra data por vencimiento o cambio de plan, solo se limita capacidad operativa.

#### Puntos de control
- `BarberApp.tsx`: si plan inactivo → muestra `<PlanExpiredView />` con mensaje y contacto
- Admin panel: si plan inactivo → solo lectura, no puede crear citas ni editar
- Super admin puede reactivar manualmente cambiando `planExpiresAt` y `active`

**No hay pasarela de pago por ahora** — el cobro se maneja fuera del sistema (transferencia, efectivo) y el super admin activa manualmente.

---

### Etapa 7 — Optimizaciones y pulido

- [ ] **SEO por barbería**: `BarberApp.tsx` actualiza `document.title` y meta description dinámicamente
- [ ] **PWA básica**: `manifest.json` + service worker para que se pueda instalar en celular
- [ ] **Loading states**: skeletons mientras carga Firestore
- [ ] **Error boundaries**: componentes de fallback para errores de red
- [ ] **Cache multicapa**: datos de configuración de la barbería en localStorage (TTL 1 hora) para reducir lecturas Firestore
- [ ] **Internacionalización**: preparar strings en objeto de constantes para futura traducción
- [ ] **Modo oscuro**: soporte básico con Tailwind dark mode
- [ ] **Métricas útiles, no decorativas**: ingresos por servicio, horas pico, barbero más solicitado, tasa de ocupación
- [ ] **Dashboard de negocio accionable** para decisiones comerciales semanales

---

## Decisiones técnicas clave

### ¿Por qué `[...slug].astro` y no rutas estáticas?
Con `getStaticPaths` habría que recompilar y redesplegar cada vez que se crea una barbería. Con un catch-all que resuelve en cliente, el sitio estático nunca necesita rebuild por alta de barberías. El único momento de rebuild es cuando cambia el código.

### ¿Por qué sin carrito real en productos?
El flujo de pago requeriría backend + pasarela (Stripe, MercadoPago). Para mantenerse 100% free, los productos muestran precio y botón de contacto por WhatsApp. Se puede agregar en una etapa futura con Cloud Functions.

### ¿Por qué sin email obligatorio en citas?
Reduce fricción para el cliente final. El teléfono es suficiente para que el barbero confirme por WhatsApp. Se puede agregar email como opcional en la Etapa 7.

### ¿Por qué autenticación solo para admins?
Los clientes que reservan no necesitan cuenta. Firestore Rules permiten escritura anónima en `appointments`. Esto simplifica radicalmente el onboarding del cliente.

---

## Checklist general de setup Firebase

- [X] Proyecto creado en Firebase Console
- [X] Authentication: Email/Password habilitado
- [X] Firestore: modo producción, reglas según modelo de datos
- [X] Storage: habilitado para logos, catálogo, productos
- [ ] Custom claims configurados para `superadmin` (script seed)
- [X] `.env` local con variables `PUBLIC_FIREBASE_*`
- [ ] Secrets en GitHub Actions configurados
- [ ] `firebase.json` y `.firebaserc` presentes (solo para functions si se usan)
- [ ] `service-account-key.json` en `.gitignore` (nunca commitear)

---

## Orden de implementación recomendado

```
Etapa 0 → Setup
Etapa 1 → Landing (valor inmediato, se puede mostrar antes de tener el sistema)
Etapa 2 → Super Admin (necesario para crear barberías)
Etapa 3 → Routing dinámico (base de todo lo demás)
Etapa 4 → Agendamiento (core del producto)
Etapa 5 → Panel admin barbería (gestión del negocio)
Etapa 6 → Control de plan (necesario antes de cobrar)
Etapa 7 → Pulido y optimizaciones
```

---

## Checklist de progreso — de cero a proyecto completo

Referencia rápida para trackear el estado del proyecto. Marcar a medida que se completa.

### Etapa 0 — Setup

- [X] Repo `barberflow` creado en GitHub (público)
- [X] GitHub Pages habilitado: Settings → Pages → Source: GitHub Actions
- [X] Proyecto Astro inicializado con template minimal + TypeScript strict
- [X] Integración React agregada (`@astrojs/react`)
- [X] Tailwind CSS 4.x instalado y configurado via `@tailwindcss/vite`
- [X] Firebase SDK instalado (`firebase`)
- [X] `astro.config.mjs` configurado con `site` y `base` correctos
- [X] Proyecto creado en Firebase Console
- [X] Firebase Authentication habilitado (Email/Password)
- [X] Firebase Firestore habilitado (modo producción)
- [X] Firebase Storage habilitado
- [X] Archivo `.env` creado con variables `PUBLIC_FIREBASE_*` (incluye `PUBLIC_FIREBASE_MEASUREMENT_ID` opcional)
- [X] `.env` agregado al `.gitignore`
- [X] `service-account-key.json` agregado al `.gitignore`
- [X] `src/lib/firebase.ts` creado (init de db, auth, storage)
- [X] Workflow `.github/workflows/deploy.yml` creado
- [X] Los 6 secrets `PUBLIC_FIREBASE_*` cargados en GitHub Actions Secrets
- [X] Primer deploy exitoso — sitio accesible en `https://<usuario>.github.io/barberflow/`
- [X] Firebase Usage alerts activadas en la consola

### Etapa 1 — Landing pública

- [X] `src/layouts/Layout.astro` creado (head, meta, slot)
- [X] `src/pages/index.astro` creada
- [X] `HeroSection.astro` — tagline + CTA
- [X] `FeaturesSection.astro` — qué ofrece el producto
- [X] `PricingSection.astro` — tabla de planes con precios definidos
- [X] `ContactSection.astro` — email / WhatsApp / formulario
- [X] `Footer.astro` — links y aviso legal
- [X] Landing responsive verificada en mobile y desktop
- [X] Deploy verificado en producción

### Etapa 2 — Super Admin

- [ ] `src/lib/auth.ts` creado (signIn, signOut, onAuthStateChanged)
- [ ] `src/lib/types.ts` creado con tipos base (Barber, User, Plan, etc.)
- [ ] `src/pages/login.astro` creada con `<LoginForm client:load />`
- [ ] Custom claim `role: 'superadmin'` seteado via script de seed
- [ ] Componente `<AuthGuard>` creado con verificación de claim y redirect
- [ ] `src/lib/barbers.ts` creado (CRUD de barberías)
- [ ] `src/pages/admin.astro` creada con `<SuperAdminApp client:load />`
- [ ] Lista de barberías con estado (activa / trial / expirada)
- [ ] Formulario crear barbería (genera barberId en Firestore)
- [ ] Control de plan: editar tipo y fecha de expiración
- [ ] Activar / desactivar barbería
- [ ] Firestore Security Rules configuradas para super admin
- [ ] Deploy verificado

### Etapa 3 — Routing dinámico

- [ ] `src/pages/b/[...slug].astro` creada (sin `getStaticPaths`)
- [ ] `404.html` creado con redirect a root + sessionStorage del path (fix GitHub Pages SPA)
- [ ] `BarberApp.tsx` creado: extrae barberId del path, consulta Firestore
- [ ] Cache de config de barbería en localStorage (TTL 1 hora) implementado
- [ ] Vista de barbería no encontrada (barberId inválido)
- [ ] Vista de plan expirado
- [ ] Navegación interna de la barbería (tabs: Inicio / Agendar / Catálogo / Productos / Ubicación)
- [ ] Vista **Inicio**: logo, nombre, dirección, horario, redes
- [ ] Vista **Catálogo**: galería de fotos con tags
- [ ] Vista **Productos**: listado con precio y botón WhatsApp
- [ ] Vista **Ubicación**: embed Google Maps con dirección de la barbería
- [ ] Deploy verificado con barbería real en `/b/{barberId}`

### Etapa 4 — Agendamiento de citas

- [ ] `src/lib/services.ts` creado (lectura de servicios con cache)
- [ ] `src/lib/appointments.ts` creado (escritura sin auth + lectura para admin)
- [ ] Paso 1: selección de servicio
- [ ] Paso 2: selección de barbero (con foto y disponibilidad)
- [ ] Paso 3: calendario con slots disponibles
  - [ ] Excluye días no laborales del local
  - [ ] Excluye horarios fuera de disponibilidad del barbero
  - [ ] Excluye slots ya ocupados (query filtrada por día)
  - [ ] Detecta solapamientos según duración del servicio
- [ ] Paso 4: servicios extra (add-ons opcionales)
- [ ] Paso 5: datos del cliente (nombre + teléfono)
- [ ] Paso 6: pantalla de confirmación con resumen
- [ ] Escritura en Firestore sin auth del cliente (status: `pending`)
- [ ] Firestore Rules: permite escritura anónima en `appointments`
- [ ] Confirmación previa por WhatsApp y recordatorios de cita
- [ ] Gestión de ausencias y cancelaciones con trazabilidad
- [ ] Reactivación automática: "hace 3 semanas no vienes, agenda de nuevo"
- [ ] Flujo completo probado end-to-end
- [ ] Deploy verificado

### Etapa 5 — Panel Admin de barbería

- [ ] Login de admin de barbería (verifica `users/{uid}.barberId`)
- [ ] Ruta `/b/{barberId}/admin` detectada en `[...slug].astro`
- [ ] `AdminApp.tsx` creado con verificación de acceso
- [ ] **Módulo Citas**
  - [ ] Vista calendario día / semana
  - [ ] Cambio de estado de cita (pendiente → confirmada → realizada / cancelada)
  - [ ] Filtro por barbero
  - [ ] Alerta de solapamiento
- [ ] **Módulo Catálogo**
  - [ ] Subida de imágenes a Firebase Storage
  - [ ] CRUD con título y tags
  - [ ] Reordenar y eliminar
- [ ] **Módulo Productos**
  - [ ] CRUD con imagen, precio y stock
  - [ ] Activar / desactivar sin borrar
- [ ] **Módulo Servicios**
  - [ ] CRUD: nombre, descripción, duración, precio
- [ ] Catálogo de servicios y extras: barba, cejas, tratamiento, combo
- [ ] **Módulo Barberos**
  - [ ] CRUD con foto
  - [ ] Disponibilidad por día (horario y slots)
  - [ ] Activar / desactivar
- [ ] **Módulo Configuración**
  - [ ] Editar nombre, dirección, teléfono, redes sociales
  - [ ] Subir logo y cover
  - [ ] Definir horario del local
  - [ ] Color primario del tema
- [ ] **Módulo Clientes**
- [ ] Historial por cliente: visitas, servicios, barbero y gasto acumulado
- [ ] **Permisos y roles**
- [ ] Roles internos: owner, admin, barber
- [ ] Restricciones por módulo según rol
- [ ] Invalidación de cache localStorage al guardar cambios
- [ ] Deploy verificado

### Etapa 6 — Control de plan

- [ ] `src/lib/planLimits.ts` creado (`isPlanActive`)
- [ ] Planes comerciales activos: standard, plus, extra
- [ ] Ciclos de facturación activos: 1, 3 y 12 meses
- [ ] Prueba gratuita por barbería: 15 días (`trialStartedAt`, `trialEndsAt`, `trialUsed`)
- [ ] Estado expirada al terminar trial sin plan pago
- [ ] Upgrade inmediato y downgrade al siguiente ciclo (configurable)
- [ ] `BarberApp.tsx` bloquea vista pública si plan inactivo
- [ ] Panel admin: solo lectura si plan inactivo
- [ ] Super admin puede reactivar plan manualmente
- [ ] Vista `<PlanExpiredView />` con mensaje y contacto
- [ ] Probado con barbería expirada manualmente

### Etapa 7 — Pulido y optimizaciones

- [ ] `document.title` y meta description actualizados dinámicamente por barbería
- [ ] `manifest.json` creado (PWA básica: nombre, íconos, theme color)
- [ ] Service worker básico registrado
- [ ] Skeletons de carga en todas las vistas que leen Firestore
- [ ] Error boundaries en componentes críticos
- [ ] Cache multicapa auditada: verificar que ningún componente hace lecturas redundantes
- [ ] Revisión de Firestore Usage: confirmar lecturas dentro del límite diario
- [ ] Modo oscuro básico con Tailwind dark mode
- [ ] Prueba de carga con múltiples barberías activas simultáneas
- [ ] Deploy final verificado en producción
